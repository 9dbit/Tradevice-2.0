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

def build_snapshot(state, anomalies, orders, queue, clock, run=None, terminal=None, commands=None):
    """Snapshot from verified Postgres records only. Absence/staleness is never ACTIVE."""
    if clock.tzinfo is None:
        raise ValueError("Database clock must have timezone")
    state = state or {}
    heartbeat = state.get("heartbeat_at")
    # Keep PostgreSQL's '-infinity' lease sentinel inside SQL to avoid datetime decoding.
    lease_valid = state.get("lease_valid") is True
    online = bool(heartbeat and lease_valid and
                  clock - STALENESS <= heartbeat <= clock + timedelta(seconds=2))
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
    run = run or {}
    terminal = terminal or []
    commands = commands or []
    safe_mode = run.get("cycle_mode")
    safe_policy = run.get("news_policy")
    safe_status = run.get("run_status") if run else "NOT_CONFIGURED"
    if safe_mode not in ("CONTINUOUS","CUSTOM"):
        safe_mode = "CONTINUOUS"
    if safe_policy not in ("AVOID","ALLOW","ONLY"):
        safe_policy = "AVOID"
    if safe_status not in ("STOPPED","RUNNING","COMPLETED","HALTED"):
        safe_status = "NOT_CONFIGURED"
    command_history = [{
       "id":str(c["id"]),"action":str(c["action"]),"status":str(c["status"]),
       "errorCode":str(c["error_code"])[:100] if c.get("error_code") else None,
       "at":iso(c.get("created_at")),"processedAt":iso(c.get("processed_at"))
    } for c in commands]
    terminal_rows = [{
       "id":str(e["id"]),"at":iso(e["observed_at"]),
       "source":str(e["source"]),"severity":str(e["severity"]),
       "kind":str(e["event_type"])[:80],"message":str(e["message"])[:240]
    } for e in terminal]

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
      "control":{
         "runStatus":safe_status,"cycleMode":safe_mode,
         "targetCycles":run.get("target_cycles") if safe_mode=="CUSTOM" else None,
         "strategyCycles":bounded(run.get("strategy_cycles")) if run else None,
         "newsPolicy":safe_policy,"sessionId":str(run["session_id"]) if run.get("session_id") else None,
         "lastRejection":str(run["last_rejection"])[:100] if run.get("last_rejection") else None,
         "operatorConfigured":False,"quotesReady":bool(online and state.get("active_source")),
         "brokerReady":False,"newsCalendarReady":False,
      },
      "terminal":terminal_rows,"commands":command_history,
    }

def snapshot_from_connection(conn):
    """Read-only connection already authenticated as dedicated reader.

    Factored for isolated PostgreSQL CI; DSN pinning remains in read_database().
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT current_user AS role, now() AS clock")
        identity=cur.fetchone()
        if identity["role"] != "tradevice_master_reader":
            raise RuntimeError("Dedicated read-only role required")
        clock=identity["clock"]
        cur.execute("""SELECT master_id,mode,heartbeat_at,(lease_until>now()) AS lease_valid,started_at,last_cycle_at,
                           cycles,healthy_cycles,anomalies,active_source,clean_ticks,reason,kill_switch
                       FROM master_control.worker_state WHERE master_id=%s""",(MASTER_ID,))
        state=cur.fetchone()
        cur.execute("""SELECT id,observed_at,severity,code,note
                       FROM master_control.anomaly_journal
                       WHERE master_id=%s ORDER BY id DESC LIMIT 30""",(MASTER_ID,))
        anomalies=cur.fetchall()
        cur.execute("""SELECT run_status,session_id,cycle_mode,target_cycles,strategy_cycles,
                           news_policy,last_rejection FROM master_control.run_state
                           WHERE master_id=%s""",(MASTER_ID,))
        run=cur.fetchone()
        cur.execute("""SELECT p.id,p.created_at,p.status,
                       s.payload->>'symbol' AS symbol,s.payload->>'side' AS side,
                       s.payload->>'quantity' AS quantity
                       FROM master_control.paper_orders p JOIN master_control.signal_queue s ON s.id=p.signal_id
                       WHERE p.master_id=%s AND p.session_id=%s
                       ORDER BY p.created_at DESC,p.id DESC LIMIT 50""",
                       (MASTER_ID,run["session_id"] if run else None))
        orders=cur.fetchall()
        cur.execute("""SELECT id,observed_at,source,severity,event_type,message
                       FROM master_control.terminal_events
                       WHERE master_id=%s ORDER BY id DESC LIMIT 60""",(MASTER_ID,))
        terminal=cur.fetchall()
        cur.execute("""SELECT id,action,status,error_code,created_at,processed_at
                       FROM master_control.operator_commands
                       WHERE master_id=%s ORDER BY created_at DESC,id DESC LIMIT 12""",(MASTER_ID,))
        commands=cur.fetchall()
        cur.execute("""SELECT status,count(*) AS n FROM master_control.signal_queue
                       WHERE master_id=%s GROUP BY status""",(MASTER_ID,))
        queue=[(r["status"],r["n"]) for r in cur.fetchall()]
    return build_snapshot(state,anomalies,orders,queue,clock,run,terminal,commands)

def read_database(dsn):
    if not allowed_reader_dsn(dsn):
        raise RuntimeError("Wrong staging master reader connection")
    with psycopg.connect(dsn, connect_timeout=8, options="-c statement_timeout=5000",
                         row_factory=dict_row, autocommit=True) as conn:
        return snapshot_from_connection(conn)
