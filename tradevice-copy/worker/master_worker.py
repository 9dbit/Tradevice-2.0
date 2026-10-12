"""Tradevice staging master supervisor. No broker connectivity and no fabricated quotes/fills."""
import logging
import os
import signal
import time
from uuid import uuid4
from urllib.parse import urlsplit, parse_qs

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("master_worker")
MASTER = "tradevice-master-staging"
INTERVAL = 2
LEASE_SECONDS = 12
stop = False

def enforce_safety(env):
    if env.get("PLATFORM_ENVIRONMENT") != "staging" or env.get("SUPABASE_PROJECT_REF") != "scqzlcivherovlwqypeu":
        raise RuntimeError("Dedicated staging only")
    expected = {"TRADING_EXECUTION_MODE":"paper","BROKER_ADAPTER":"paper",
                "BROKER_LIVE_ENABLED":"false","COPY_EXECUTION_ENABLED":"false"}
    for key,value in expected.items():
        if env.get(key) != value:
            raise RuntimeError(f"Unsafe configuration: {key}")
    if env.get("MASTER_QUOTE_SOURCE","none") != "none":
        raise RuntimeError("No trusted market feed adapter has been approved")
    errors=database_url_errors(env.get("MASTER_DATABASE_URL",""))
    if errors:
        # Only static field labels are logged. Never log the DSN or credentials.
        raise RuntimeError("MASTER_DATABASE_URL validation failed: " + ",".join(errors))


def database_url_errors(dsn):
    """Diagnose fields without logging connection strings or password contents."""
    if not isinstance(dsn,str) or not dsn:
        return ["missing"]
    try:
        parts=urlsplit(dsn)
        query=parse_qs(parts.query)
        checks={
            "scheme":parts.scheme in ("postgresql","postgres"),
            "host":parts.hostname=="db.scqzlcivherovlwqypeu.supabase.co",
            "port":parts.port==5432,
            "database":parts.path=="/postgres",
            "username":parts.username=="tradevice_master_worker",
            "password_present":bool(parts.password),
            "sslmode":query.get("sslmode")==["require"],
            "no_fragment":not parts.fragment,
            "no_surrounding_whitespace":dsn==dsn.strip(),
        }
        return [name for name,valid in checks.items() if not valid]
    except (ValueError,TypeError):
        return ["malformed_url"]


def cycle_state(kill_switch):
    """Never call this offline-only supervisor ACTIVE without an approved quote source."""
    return ("HALTED","MANUAL_KILL") if kill_switch else ("DEGRADED","MISSING_TRUSTED_QUOTE")

def _stop(*args):
    global stop
    stop=True

def command_decision(action, run_status, kill_switch):
    """Business gates do not trust operator requests as market readiness evidence."""
    if action == "START":
        if kill_switch:
            return "REJECTED", "MANUAL_KILL_ACTIVE"
        if run_status == "RUNNING":
            return "REJECTED", "RUN_ALREADY_ACTIVE"
        # There is no approved quote / broker / calendar adapter yet.
        # Never equate a 2s supervisor heartbeat with a valid trade cycle.
        return "REJECTED", "TRUSTED_MARKET_AND_PAPER_BROKER_NOT_READY"
    if action in ("CONFIGURE", "RESET_SESSION") and run_status == "RUNNING":
        return "REJECTED", "STOP_TRIAL_FIRST"
    return "APPLIED", None


def process_operator_commands(cur, worker_id, kill_switch):
    """Apply idempotent, audited commands under the worker's leadership lock.

    No command can release the emergency kill switch, write paper fills,
    approve a market feed or enable live order execution.
    """
    cur.execute("""INSERT INTO master_control.run_state(master_id)
                   VALUES (%s) ON CONFLICT DO NOTHING""", (MASTER,))
    cur.execute("""SELECT run_status,session_id,cycle_mode,target_cycles,news_policy
                   FROM master_control.run_state WHERE master_id=%s FOR UPDATE""", (MASTER,))
    run = cur.fetchone()
    cur.execute("""INSERT INTO master_control.run_sessions(id,master_id)
                   VALUES (%s,%s) ON CONFLICT DO NOTHING""", (run["session_id"], MASTER))
    cur.execute("""SELECT id,actor_id,action,cycle_mode,target_cycles,news_policy
                   FROM master_control.operator_commands
                   WHERE master_id=%s AND status='PENDING'
                   ORDER BY created_at ASC,id ASC FOR UPDATE SKIP LOCKED LIMIT 16""", (MASTER,))
    commands = cur.fetchall()
    for cmd in commands:
        action = cmd["action"]
        decision, code = command_decision(action, run["run_status"], kill_switch)
        if decision == "APPLIED" and action == "RESET_SESSION":
            cur.execute("""SELECT EXISTS(
                  SELECT 1 FROM master_control.signal_queue WHERE master_id=%s
                  AND status IN ('QUEUED','RETRY','ACCEPTED_SIMULATED')
                ) AS pending""", (MASTER,))
            if cur.fetchone()["pending"]:
                decision,code = "REJECTED","PENDING_OR_UNRECONCILED_SIGNALS"
        if decision == "APPLIED" and action == "CONFIGURE":
            cur.execute("""UPDATE master_control.run_state
                 SET cycle_mode=%s,target_cycles=%s,news_policy=%s,
                     last_rejection=NULL,last_command_id=%s,updated_at=now()
                 WHERE master_id=%s""",
                 (cmd["cycle_mode"],cmd["target_cycles"],cmd["news_policy"],cmd["id"],MASTER))
            run["cycle_mode"] = cmd["cycle_mode"]
            run["target_cycles"] = cmd["target_cycles"]
            run["news_policy"] = cmd["news_policy"]
        elif decision == "APPLIED" and action == "STOP":
            cur.execute("""UPDATE master_control.run_state
                 SET run_status='STOPPED',last_rejection=NULL,
                     last_command_id=%s,updated_at=now()
                 WHERE master_id=%s""", (cmd["id"],MASTER))
            run["run_status"] = "STOPPED"
        elif decision == "APPLIED" and action == "RESET_SESSION":
            cur.execute("""UPDATE master_control.run_sessions
                           SET ended_at=now() WHERE id=%s AND ended_at IS NULL""",
                        (run["session_id"],))
            new_session = str(uuid4())
            cur.execute("""INSERT INTO master_control.run_sessions(id,master_id,initiated_by)
                           VALUES (%s,%s,%s)""", (new_session,MASTER,cmd["actor_id"]))
            cur.execute("""UPDATE master_control.run_state
                   SET session_id=%s,run_status='STOPPED',strategy_cycles=0,
                       last_rejection=NULL,last_command_id=%s,updated_at=now()
                   WHERE master_id=%s""", (new_session,cmd["id"],MASTER))
            run["session_id"] = new_session
            run["run_status"] = "STOPPED"
        if decision == "REJECTED":
            cur.execute("""UPDATE master_control.run_state
                 SET last_rejection=%s,last_command_id=%s,updated_at=now()
                 WHERE master_id=%s""",(code,cmd["id"],MASTER))
        cur.execute("""UPDATE master_control.operator_commands
                    SET status=%s,error_code=%s,processed_at=now() WHERE id=%s""",
                    (decision,code,cmd["id"]))
        severity = "warning" if decision == "REJECTED" else "info"
        message = code if code else (action + " confirmed for paper trial")
        cur.execute("""INSERT INTO master_control.terminal_events
            (master_id,session_id,source,severity,event_type,message,command_id)
            VALUES (%s,%s,'CONTROL',%s,%s,%s,%s)""",
            (MASTER,run["session_id"],severity,"COMMAND_"+decision,message,cmd["id"]))
        log.info("operator command %s: %s",action,decision)


def transact(conn, worker_id):
    """Database row lock serializes leadership, heartbeat and cycle event atomically."""
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""INSERT INTO master_control.worker_state(master_id)
                           VALUES (%s) ON CONFLICT DO NOTHING""",(MASTER,))
            # Compute lease validity inside PostgreSQL: the schema intentionally
            # defaults to '-infinity', which psycopg cannot decode as datetime.
            # This also keeps all leadership decisions on the DB clock.
            cur.execute("""SELECT holder_id,(lease_until>now()) AS lease_valid,
                               lease_epoch,mode,kill_switch
                           FROM master_control.worker_state WHERE master_id=%s FOR UPDATE""",(MASTER,))
            state=cur.fetchone()
            other=state["holder_id"] is not None and str(state["holder_id"])!=worker_id
            if other and state["lease_valid"]:
                return False
            takeover=(state["holder_id"] is None or str(state["holder_id"])!=worker_id or not state["lease_valid"])
            epoch=state["lease_epoch"]+(1 if takeover else 0)
            mode,reason=cycle_state(state["kill_switch"])
            anomaly_transition=(mode=="DEGRADED" and state["mode"]!="DEGRADED")
            cur.execute("""UPDATE master_control.worker_state SET holder_id=%s,
               lease_until=now()+(%s * interval '1 second'),lease_epoch=%s,
               started_at=CASE WHEN %s THEN now() ELSE coalesce(started_at,now()) END,
               heartbeat_at=now(),last_cycle_at=now(),mode=%s,reason=%s,
               cycles=cycles+1,anomalies=anomalies+%s,clean_ticks=0,last_bad_at=now(),
               active_source=NULL,updated_at=now() WHERE master_id=%s""",
               (worker_id,LEASE_SECONDS,epoch,takeover,mode,reason,1 if anomaly_transition else 0,MASTER))
            cur.execute("""INSERT INTO master_control.cycle_history
               (master_id,worker_id,lease_epoch,mode,reason,safe_to_admit)
               VALUES (%s,%s,%s,%s,%s,false)""",(MASTER,worker_id,epoch,mode,reason))
            if anomaly_transition:
                cur.execute("""INSERT INTO master_control.anomaly_journal
                 (master_id,worker_id,severity,code,note)
                 VALUES (%s,%s,'warning','MISSING_TRUSTED_QUOTE','No trusted source configured; paper orders blocked')""",(MASTER,worker_id))
            if state["mode"]!=mode:
                cur.execute("""INSERT INTO master_control.recovery_records
                  (master_id,worker_id,from_state,to_state,reason,clean_ticks)
                  VALUES (%s,%s,%s,%s,%s,0)""",(MASTER,worker_id,state["mode"],mode,reason))
            cur.execute("""UPDATE master_control.signal_queue SET status='EXPIRED',
                 last_error='SIGNAL_TTL',updated_at=now()
                 WHERE master_id=%s AND status IN ('QUEUED','RETRY') AND expires_at<=now()""",(MASTER,))
            process_operator_commands(cur,worker_id,state["kill_switch"])
            return True

def run():
    enforce_safety(os.environ)
    worker_id=str(uuid4())
    log.info("staging paper-only supervisor started id=%s",worker_id)
    while not stop:
        started=time.monotonic()
        try:
            with psycopg.connect(os.environ["MASTER_DATABASE_URL"],connect_timeout=5,
                                 options="-c statement_timeout=6000",autocommit=True) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT current_user")
                    current_user=cur.fetchone()[0]
                if current_user!="tradevice_master_worker":
                    raise RuntimeError("Connection must authenticate as dedicated tradevice_master_worker role")
                leader=transact(conn,worker_id)
                if leader:
                    log.info("heartbeat: paper-only supervisor; new orders blocked")
                else:
                    log.info("standby: lease owned by another worker")
        except Exception as exc:
            log.error("fail-closed cycle, no order activity: %s",type(exc).__name__)
        remaining=max(0,INTERVAL-(time.monotonic()-started))
        until=time.monotonic()+remaining
        while not stop and time.monotonic()<until:
            time.sleep(min(.25,until-time.monotonic()))
    log.info("worker exiting; lease expires without unsafe takeover")

if __name__=="__main__":
    signal.signal(signal.SIGTERM,_stop)
    signal.signal(signal.SIGINT,_stop)
    run()
