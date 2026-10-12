"""PostgreSQL integration tests run ONLY against the isolated GitHub Actions test database.

A real PostgreSQL server is necessary here: mocks cannot prove row locks,
role permissions, RLS, or atomic takeover. Never connect to Supabase.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
import os

import psycopg
import pytest
from psycopg.rows import dict_row

from master_worker import MASTER, cycle_state, transact
from app.master_telemetry import snapshot_from_connection

MIGRATIONS = (
    "202610120001_master_control_private_paper_telemetry.sql",
    "202610120002_master_control_telemetry_reader_rls.sql",
    "202610120003_master_control_worker_least_privilege.sql",
    "202610120004_master_operator_control.sql",
)
ROOT = Path(__file__).resolve().parents[1] / "database" / "migrations"


@pytest.fixture(scope="module")
def postgres_dsn():
    dsn = os.environ.get("MASTER_TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("Isolated CI PostgreSQL not configured")
    parsed = urlsplit(dsn)
    if parsed.hostname not in ("127.0.0.1", "localhost") or parsed.path != "/tradevice_master_ci" or parsed.username != "postgres":
        pytest.fail("Integration test refuses non-local or non-ephemeral DB")
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user")
            assert cur.fetchone() == ("tradevice_master_ci", "postgres")
            # Supabase built-in API roles do not exist in stock PostgreSQL.
            cur.execute('CREATE ROLE anon NOLOGIN')
            cur.execute('CREATE ROLE authenticated NOLOGIN')
            for name in MIGRATIONS:
                cur.execute((ROOT / name).read_text(encoding="utf-8"))
    return dsn


@pytest.fixture()
def dsn(postgres_dsn):
    # The database is temporary in GitHub Actions. Never clean persistent DBs.
    with psycopg.connect(postgres_dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""TRUNCATE master_control.admin_audit, master_control.admin_commands,
              master_control.paper_orders, master_control.signal_queue,
              master_control.anomaly_journal, master_control.recovery_records,
              master_control.cycle_history, master_control.worker_state RESTART IDENTITY CASCADE""")
    return postgres_dsn


@contextmanager
def as_role(dsn, role):
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(f"SET ROLE {role}")  # Only literal roles from test code.
        yield conn


def value(dsn, sql, params=()):
    with psycopg.connect(dsn, autocommit=True) as conn:
        return conn.execute(sql, params).fetchone()[0]


def test_two_contenders_claim_only_one_lease(dsn):
    workers = [str(uuid4()), str(uuid4())]
    def claim(worker_id):
        with as_role(dsn, "tradevice_master_worker") as conn:
            return transact(conn, worker_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, workers))
    assert sorted(results) == [False, True]
    assert value(dsn, "SELECT cycles FROM master_control.worker_state WHERE master_id=%s", (MASTER,)) == 1
    assert value(dsn, "SELECT count(*) FROM master_control.cycle_history") == 1
    assert value(dsn, "SELECT count(*) FROM master_control.anomaly_journal") == 1
    assert value(dsn, "SELECT bool_and(safe_to_admit=false) FROM master_control.cycle_history") is True


def test_expiry_takeover_is_fenced_and_heartbeat_persists(dsn):
    a, b = str(uuid4()), str(uuid4())
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, a)
        assert not transact(conn, b)
    first_epoch = value(dsn, "SELECT lease_epoch FROM master_control.worker_state")
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute("UPDATE master_control.worker_state SET lease_until=now()-interval '1 second'")
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, b)
        assert not transact(conn, a)
    assert value(dsn, "SELECT lease_epoch FROM master_control.worker_state") == first_epoch + 1
    assert str(value(dsn, "SELECT holder_id FROM master_control.worker_state")) == b
    assert value(dsn, "SELECT cycles FROM master_control.worker_state") == 2
    assert value(dsn, "SELECT count(*) FROM master_control.anomaly_journal") == 1


def test_kill_switch_stops_admissions_and_cannot_be_cleared_by_worker(dsn):
    worker = str(uuid4())
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, worker)
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute("UPDATE master_control.worker_state SET kill_switch=true")
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, worker)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("UPDATE master_control.worker_state SET kill_switch=false")
    assert value(dsn, "SELECT kill_switch FROM master_control.worker_state") is True
    assert value(dsn, "SELECT mode FROM master_control.worker_state") == "HALTED"
    assert value(dsn, "SELECT bool_and(safe_to_admit=false) FROM master_control.cycle_history") is True
    assert cycle_state(True)[0] == "HALTED"


def test_expired_signals_only_and_no_duplicate_orders(dsn):
    worker = str(uuid4())
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, worker)
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute("""INSERT INTO master_control.signal_queue
           (master_id,idempotency_key,payload,expires_at) VALUES
           (%s,'test-expired-one','{}',now()-interval '1 second'),
           (%s,'test-future-one','{}',now()+interval '1 hour')""", (MASTER, MASTER))
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, worker)
        assert transact(conn, worker)
    assert value(dsn, "SELECT status FROM master_control.signal_queue WHERE idempotency_key='test-expired-one'") == "EXPIRED"
    assert value(dsn, "SELECT status FROM master_control.signal_queue WHERE idempotency_key='test-future-one'") == "QUEUED"
    assert value(dsn, "SELECT count(*) FROM master_control.paper_orders") == 0
    assert value(dsn, "SELECT count(*) FROM master_control.anomaly_journal") == 1


def test_worker_is_denied_admin_and_execution_writes(dsn):
    with as_role(dsn, "tradevice_master_worker") as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO master_control.admin_audit(actor_id,action,request_id,outcome) VALUES (%s,'TEST',%s,'OK')", (str(uuid4()),str(uuid4())))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO master_control.paper_orders(master_id,signal_id,status) VALUES (%s,%s,'UNKNOWN')", (MASTER,str(uuid4())))
    assert value(dsn, "SELECT count(*) FROM master_control.admin_audit") == 0
    assert value(dsn, "SELECT count(*) FROM master_control.paper_orders") == 0


def test_reader_can_read_telemetry_but_cannot_write(dsn):
    worker = str(uuid4())
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, worker)
    with as_role(dsn, "tradevice_master_reader") as conn:
        row = conn.execute("SELECT mode,cycles FROM master_control.worker_state WHERE master_id=%s", (MASTER,)).fetchone()
        assert row == ("DEGRADED", 1)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("UPDATE master_control.worker_state SET cycles=99 WHERE master_id=%s", (MASTER,))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SELECT * FROM master_control.admin_commands")
    assert value(dsn, "SELECT cycles FROM master_control.worker_state") == 1


def test_member_postgres_role_cannot_read_private_schema(dsn):
    with as_role(dsn, "authenticated") as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SELECT * FROM master_control.worker_state")



def test_reader_query_handles_uninitialized_infinite_lease(dsn):
    # Default lease is '-infinity'. A reader must display OFFLINE, not raise DataError.
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute("INSERT INTO master_control.worker_state(master_id) VALUES (%s)", (MASTER,))
    with as_role(dsn, "tradevice_master_reader") as conn:
        snapshot = snapshot_from_connection(conn)
    assert snapshot["source"] == "STAGING_WORKER_TELEMETRY"
    assert snapshot["master"]["state"] == "OFFLINE/STALE"
    assert snapshot["master"]["heartbeatAt"] is None
    assert snapshot["risk"]["pnlUsd"] is None
    assert snapshot["paperOrders"] == []


def test_reader_query_returns_real_worker_heartbeat(dsn):
    with as_role(dsn, "tradevice_master_worker") as conn:
        assert transact(conn, str(uuid4()))
    with as_role(dsn, "tradevice_master_reader") as conn:
        snapshot = snapshot_from_connection(conn)
    assert snapshot["master"]["state"] == "DEGRADED"
    assert snapshot["master"]["cycles"] == 1
    assert snapshot["master"]["reason"] == "MISSING_TRUSTED_QUOTE"
    assert snapshot["infrastructure"]["masterWorker"] == "ONLINE"
    assert snapshot["activity"][0]["kind"] == "MISSING_TRUSTED_QUOTE"
    assert snapshot["paperExecution"]["fillsVerified"] is False


def test_operator_commands_are_idempotent_and_do_not_unlock_trading(dsn):
    worker=str(uuid4())
    with as_role(dsn,"tradevice_master_worker") as conn:
        assert transact(conn,worker)
    actor,request=str(uuid4()),str(uuid4())
    with as_role(dsn,"tradevice_master_operator") as conn:
        row=conn.execute("""INSERT INTO master_control.operator_commands
           (master_id,actor_id,action,idempotency_key)
           VALUES (%s,%s,'START',%s)""", (MASTER,actor,request))
        assert row.rowcount==1
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute("""INSERT INTO master_control.operator_commands
               (master_id,actor_id,action,idempotency_key)
               VALUES (%s,%s,'START',%s)""",(MASTER,actor,request))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SELECT * FROM master_control.operator_commands")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("UPDATE master_control.worker_state SET kill_switch=false")
    with as_role(dsn,"tradevice_master_worker") as conn:
        assert transact(conn,worker)
    assert value(dsn,"SELECT status FROM master_control.operator_commands WHERE idempotency_key=%s",(request,))=="REJECTED"
    assert value(dsn,"SELECT error_code FROM master_control.operator_commands WHERE idempotency_key=%s",(request,))=="TRUSTED_MARKET_AND_PAPER_BROKER_NOT_READY"
    assert value(dsn,"SELECT run_status FROM master_control.run_state")=="STOPPED"
    assert value(dsn,"SELECT count(*) FROM master_control.paper_orders")==0


def test_configure_stop_and_reset_preserve_auditable_history(dsn):
    worker=str(uuid4())
    with as_role(dsn,"tradevice_master_worker") as conn:
        assert transact(conn,worker)
    original=value(dsn,"SELECT session_id FROM master_control.run_state")
    actor=str(uuid4())
    for action, mode,cycles,news in [
      ("CONFIGURE","CUSTOM",7,"AVOID"),
      ("STOP",None,None,None),
      ("RESET_SESSION",None,None,None),
    ]:
        with as_role(dsn,"tradevice_master_operator") as conn:
            conn.execute("""INSERT INTO master_control.operator_commands
             (master_id,actor_id,action,idempotency_key,cycle_mode,target_cycles,news_policy)
             VALUES(%s,%s,%s,%s,%s,%s,%s)""",
             (MASTER,actor,action,str(uuid4()),mode,cycles,news))
        with as_role(dsn,"tradevice_master_worker") as conn:
            assert transact(conn,worker)
    with as_role(dsn,"tradevice_master_reader") as conn:
        snapshot=snapshot_from_connection(conn)
    assert snapshot["control"]["cycleMode"]=="CUSTOM"
    assert snapshot["control"]["targetCycles"]==7
    assert snapshot["control"]["strategyCycles"]==0
    assert snapshot["control"]["runStatus"]=="STOPPED"
    assert snapshot["control"]["sessionId"]!=str(original)
    assert len(snapshot["terminal"])==3
    assert len(snapshot["commands"])==3
    assert value(dsn,"SELECT count(*) FROM master_control.run_sessions")==2
    assert value(dsn,"SELECT count(*) FROM master_control.operator_commands")==3
    assert value(dsn,"SELECT count(*) FROM master_control.cycle_history")==4


def test_reader_and_member_cannot_submit_operator_command(dsn):
    with psycopg.connect(dsn,autocommit=True) as admin:
        admin.execute("INSERT INTO master_control.worker_state(master_id) VALUES (%s)",(MASTER,))
    for role in ("tradevice_master_reader","authenticated"):
        with as_role(dsn,role) as conn:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute("""INSERT INTO master_control.operator_commands
                  (master_id,actor_id,action,idempotency_key)
                  VALUES (%s,%s,'STOP',%s)""",(MASTER,str(uuid4()),str(uuid4())))
