from datetime import datetime, timedelta, timezone
from app.master_telemetry import allowed_reader_dsn, build_snapshot

NOW=datetime(2026,10,12,5,0,0,tzinfo=timezone.utc)
DSN="postgresql://tradevice_master_reader:secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require"

def state(**kwargs):
    return dict(master_id="tradevice-master-staging",mode="DEGRADED",
        heartbeat_at=NOW-timedelta(seconds=2), lease_until=NOW+timedelta(seconds=8),
        last_cycle_at=NOW-timedelta(seconds=2),started_at=NOW-timedelta(minutes=1),
        cycles=20,healthy_cycles=0,anomalies=1,active_source=None,clean_ticks=0,
        reason="MISSING_TRUSTED_QUOTE",kill_switch=False,**kwargs)

def test_reader_dsn_pinned():
    assert allowed_reader_dsn(DSN)
    for wrong in [DSN.replace("tradevice_master_reader","postgres"),
                  DSN.replace("scqzlcivherovlwqypeu","otherprojectxxxxxxx"),
                  DSN.replace("sslmode=require","sslmode=disable"),
                  "postgresql://reader:bad@localhost:5432/postgres", ""]:
        assert not allowed_reader_dsn(wrong)

def test_fresh_real_degraded_without_fake_pnl():
    s=build_snapshot(state(),[],[],[("QUEUED",2)],NOW)
    assert s["source"]=="STAGING_WORKER_TELEMETRY"
    assert s["master"]["state"]=="DEGRADED"
    assert s["infrastructure"]["masterWorker"]=="ONLINE"
    assert s["master"]["cycles"]==20 and s["queue"]["queued"]==2
    assert s["risk"]["pnlUsd"] is None and s["risk"]["winRatePct"] is None
    assert s["paperExecution"]["fillsVerified"] is False
    assert s["equityCurve"]==[]

def test_expired_lease_forces_stale_even_with_recent_heartbeat():
    s=state();s["lease_until"]=NOW-timedelta(seconds=1)
    v=build_snapshot(s,[],[],[],NOW)
    assert v["master"]["state"]=="OFFLINE/STALE"
    assert v["infrastructure"]["masterWorker"]=="OFFLINE/STALE"

def test_missing_worker_never_active():
    v=build_snapshot(None,[],[],[],NOW)
    assert v["master"]["state"]=="OFFLINE/STALE"
    assert v["master"]["cycles"] is None
    assert v["risk"]["killSwitch"]=="UNAVAILABLE"

def test_active_without_trusted_source_degrades():
    s=state();s["mode"]="ACTIVE"
    v=build_snapshot(s,[],[],[],NOW)
    assert v["master"]["state"]=="DEGRADED"

def test_verified_paper_ack_is_not_fill():
    orders=[dict(id="test-order",status="ACCEPTED_SIMULATED",symbol="XAUUSD",side="BUY",quantity="0.01",created_at=NOW)]
    v=build_snapshot(state(),[],orders,[("ACCEPTED_SIMULATED",1)],NOW)
    assert v["paperExecution"]["accepted"]==1
    assert v["paperExecution"]["fillsVerified"] is False
    assert v["risk"]["pnlUsd"] is None
