"""Privileged, staging-only read-only master telemetry. No synthetic values or broker side effects."""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, parse_qs

import psycopg
from psycopg.rows import dict_row

PROJECT_REF = "scqzlcivherovlwqypeu"
MASTER_ID = "tradevice-master-staging"
STALENESS = timedelta(seconds=12)

def allowed_reader_dsn(value: str) -> bool:
    try:
        u = urlsplit(value)
        return bool(u.scheme in ("postgresql", "postgres") and
          u.hostname == f"db.{PROJECT_REF}.supabase.co" and u.port == 5432 and
          u.path == "/postgres" and u.username == "tradevice_master_reader" and
          u.password and parse_qs(u.query).get("sslmode") == ["require"])
    except (ValueError, TypeError):
        return False

def iso(value):
    return value.isoformat() if isinstance(value, datetime) else None

def bounded(v):
    try:
        n = int(v)
        return max(0, n) if n <= 10**13 else None
    except (TypeError, ValueError):
        return None

def build_snapshot(state, anomalies, orders, queue, clock):
    """Snapshot from verified Postgres records only. Absence/staleness is never ACTIVE."""
    if clock.tzinfo is None:
        raise ValueError("Database clock must have timezone")
    state = state or {}
    heartbeat = state.get("heartbeat_at")
    lease = state.get("lease_until")
    online = bool(heartbeat and lease and clock - STALENESS <= heartbeat <= clock + timedelta(seconds=2)
                  and lease > clock)
    raw_mode = state.get("mode")
    safe_state = raw_mode if online and raw_mode in ("ACTIVE","DEGRADED","RECOVERING","HALTED") else "OFFLINE/STALE"
    if safe_state == "ACTIVE" and not state.get("active_source"):
        safe_state = "DEGRADED"
    started = state.get("started_at")
    uptime = bounded((clock-started).total_seconds()) if online and started and started <= clock else None
    events = []
    for row in anomalies:
        events.append({"id":str(row["id"]),"at":iso(row.get("observed_at")),
                       "severity":row.get("severity","warning"),
                       "kind":str(row.get("code") or "UNKNOWN")[:100],
                       "note":str(row.get("note") or "")[:500]})
    paper = []
    for row in orders:
        symbol=str(row.get("symbol") or "UNSPECIFIED")[:24]
        side=row.get("side") if row.get("side") in ("BUY","SELL") else "N/A"
        quantity=str(row.get("quantity") or "N/A")[:16]
        paper.append({"id":str(row["id"]),"symbol":symbol,"side":side,
                      "state":row.get("status","UNKNOWN"),"quantity":quantity,
                      "at":iso(row.get("created_at"))})
    queue_counts = {k:int(v) for k,v in queue}
    return {
      "source":"STAGING_WORKER_TELEMETRY", "environment":"staging",
      "observedAt":iso(clock), "executionMode":"PAPER_ONLY",
      "master":{
        "id":state.get("master_id"),"state":safe_state,"heartbeatAt":iso(heartbeat),
        "lastCycleAt":iso(state.get("last_cycle_at")),
        "uptimeSeconds":uptime,
        "cycles":bounded(state.get("cycles")),"healthyCycles":bounded(state.get("healthy_cycles")),
        "anomalies":bounded(state.get("anomalies")),
        "activeSource":state.get("active_source") if online else None,
        "recoveryTicks":bounded(state.get("clean_ticks")),
        "reason":state.get("reason") if state else "NO_HEARTBEAT",
      },
      "risk":{
        "killSwitch":"ENGAGED" if state.get("kill_switch") else ("DISENGAGED" if state else "UNAVAILABLE"),
        "positions":None,"equityUsd":None,"pnlUsd":None,"drawdownPct":None,"winRatePct":None,
      },
      "infrastructure":{
        "masterWorker":"ONLINE" if online else "OFFLINE/STALE",
        "journal":"CONNECTED","adminAuth":"VERIFIED",
      },
      "queue":{"queued":queue_counts.get("QUEUED",0),"retry":queue_counts.get("RETRY",0),
               "expired":queue_counts.get("EXPIRED",0),"rejected":queue_counts.get("REJECTED",0),
               "accepted":queue_counts.get("ACCEPTED_SIMULATED",0),
               "deadLetter":queue_counts.get("DEAD_LETTER",0)},
      "paperExecution":{"accepted":sum(o["state"]=="ACCEPTED_SIMULATED" for o in paper),
                        "rejected":sum(o["state"]=="REJECTED" for o in paper),
                        "fillsVerified":False},
      "activity":events,"paperOrders":paper,"equityCurve":[],
    }

def read_database(dsn):
    if not allowed_reader_dsn(dsn):
        raise RuntimeError("Wrong staging master reader connection")
    with psycopg.connect(dsn, connect_timeout=8, options="-c statement_timeout=5000",
                         row_factory=dict_row, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_user AS role, now() AS clock")
            identity=cur.fetchone()
            if identity["role"] != "tradevice_master_reader":
                raise RuntimeError("Dedicated read-only role required")
            clock=identity["clock"]
            cur.execute("""SELECT master_id,mode,heartbeat_at,lease_until,started_at,last_cycle_at,
                               cycles,healthy_cycles,anomalies,active_source,clean_ticks,reason,kill_switch
                           FROM master_control.worker_state WHERE master_id=%s""",(MASTER_ID,))
            state=cur.fetchone()
            cur.execute("""SELECT id,observed_at,severity,code,note
                           FROM master_control.anomaly_journal
                           WHERE master_id=%s ORDER BY id DESC LIMIT 30""",(MASTER_ID,))
            anomalies=cur.fetchall()
            cur.execute("""SELECT p.id,p.created_at,p.status,
                           s.payload->>'symbol' AS symbol,s.payload->>'side' AS side,
                           s.payload->>'quantity' AS quantity
                           FROM master_control.paper_orders p JOIN master_control.signal_queue s ON s.id=p.signal_id
                           WHERE p.master_id=%s ORDER BY p.created_at DESC LIMIT 30""",(MASTER_ID,))
            orders=cur.fetchall()
            cur.execute("""SELECT status,count(*) AS n FROM master_control.signal_queue
                           WHERE master_id=%s GROUP BY status""",(MASTER_ID,))
            queue=[(r["status"],r["n"]) for r in cur.fetchall()]
    return build_snapshot(state,anomalies,orders,queue,clock)
