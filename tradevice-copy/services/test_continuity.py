"""No broker network calls or fabricated fills in these tests."""
from decimal import Decimal as D
import pytest
from continuity_engine import ContinuityEngine, Policy, Quote, Signal
from paper_broker import PaperBroker
from validation import SimulatedExit, evaluate, replay_file

A="11111111-1111-4111-8111-111111111111"
B="22222222-2222-4222-8222-222222222222"


class Clock:
    def __init__(self): self.now=1770000000.0
    def __call__(self): return self.now
    def step(self,n=1): self.now+=n


def signal(c,key="test-1",**patch):
    v=dict(account_id=A,key=key,symbol="XAUUSD",side="BUY",
           quantity=D(".01"),entry=D("4000"),stop_loss=D("3995"),
           take_profit=D("4010"),equity_usd=D("5000"),expires_at=int(c())+60)
    v.update(patch)
    return Signal(**v)


def quote(c,n,bid=D("4000"),ask=D("4000.1"),source="primary"):
    return Quote(source,n,c(),bid,ask)


@pytest.fixture
def rig(tmp_path):
    c=Clock()
    b=PaperBroker(str(tmp_path/"orders.sqlite"))
    def mk(**kw):
        return ContinuityEngine(master_id="master-1",broker=b,
          journal_path=str(tmp_path/"cycles.sqlite"),
          policy=Policy(recovery_cooldown_s=0),clock=c,**kw)
    e=mk()
    yield e,b,c,mk
    e.close()
    b.close()


def ready(e,c,start=1):
    for i in range(start,start+3):
        e.cycle(quote(c,i))
        c.step()


def test_clean_ticks_then_accepted_simulated_no_fill(rig):
    e,b,c,_=rig
    assert e.enqueue(signal(c))=="QUEUED"
    e.cycle(quote(c,1))
    assert e.snapshot()["mode"]=="RECOVERING"
    e.cycle(quote(c,2))
    assert e.snapshot()["signals"]=={"QUEUED":1}
    e.cycle(quote(c,3))
    assert e.snapshot()["mode"]=="ACTIVE"
    assert e.snapshot()["signals"]=={"ACCEPTED_SIMULATED":1}
    payload=b._db.execute("SELECT payload FROM paper_orders").fetchone()[0]
    assert "ACCEPTED_SIMULATED" in payload and "fill_price" not in payload


def test_anomaly_keeps_heartbeat_and_auto_recovers(rig):
    e,b,c,_=rig
    ready(e,c)
    n=e.snapshot()["cycles"]
    assert e.cycle(None)["mode"]=="DEGRADED"
    assert e.snapshot()["cycles"]==n+1
    e.enqueue(signal(c,key="wait"))
    assert e.cycle(quote(c,4,ask=D("4200")))["mode"]=="DEGRADED"
    assert e.snapshot()["signals"]=={"QUEUED":1}
    ready(e,c,5)
    assert e.snapshot()["mode"]=="ACTIVE"
    assert e.snapshot()["signals"]=={"ACCEPTED_SIMULATED":1}


def test_duplicate_or_stale_quote_fails_closed(rig):
    e,b,c,_=rig
    e.cycle(quote(c,1))
    assert e.cycle(quote(c,1))["reason"]=="OUT_OF_ORDER"
    assert e.cycle(Quote("primary",2,c()-100,D("4000"),D("4001")))["mode"]=="DEGRADED"


def test_gap_and_spread_prevent_paper_orders(rig):
    e,b,c,_=rig
    e.enqueue(signal(c))
    for i in range(1,5):
        assert e.cycle(quote(c,i,ask=D("4200")))["mode"]=="DEGRADED"
    assert e.snapshot()["cycles"]==4
    assert b._db.execute("SELECT count(*) FROM paper_orders").fetchone()[0]==0


def test_stale_queue_expires_while_cycle_continues(rig):
    e,b,c,_=rig
    e.enqueue(signal(c,expires_at=int(c())+2))
    for i in range(4):
        e.cycle(None)
        c.step()
    ready(e,c)
    assert e.snapshot()["signals"]=={"EXPIRED":1}


def test_manual_kill_latches_even_with_healthy_quotes(rig):
    e,b,c,_=rig
    e.enqueue(signal(c))
    e.kill_switch(True)
    for i in range(1,4):
        assert e.cycle(quote(c,i))["mode"]=="HALTED"
    e.kill_switch(False)
    assert e.snapshot()["mode"]=="DEGRADED"
    ready(e,c,4)
    assert e.snapshot()["signals"]=={"ACCEPTED_SIMULATED":1}


def test_risk_and_idempotency_guards(rig):
    e,b,c,_=rig
    assert e.enqueue(signal(c))=="QUEUED"
    assert e.enqueue(signal(c))=="QUEUED"
    with pytest.raises(ValueError,match="conflicting"):
        e.enqueue(signal(c,quantity=D(".02")))
    with pytest.raises(ValueError,match="risk cap"):
        e.enqueue(signal(c,key="too_big",quantity=D("1")))
    with pytest.raises(ValueError):
        e.enqueue(signal(c,key="nan",entry=D("NaN")))


def test_account_capacity_and_other_member_separation(rig):
    e,b,c,_=rig
    for n in range(4):
        e.enqueue(signal(c,key="a"+str(n)))
    e.enqueue(signal(c,key="other",account_id=B))
    ready(e,c)
    assert e.snapshot()["signals"]=={"ACCEPTED_SIMULATED":4,"QUEUED":1}


def test_restart_and_exactly_once_broker_ack(rig):
    e,b,c,mk=rig
    e.enqueue(signal(c,key="restart"))
    ready(e,c)
    old=e.db.execute("SELECT order_id FROM signal_inbox").fetchone()[0]
    e.close()
    e2=mk()
    assert e2.enqueue(signal(c,key="restart"))=="ACCEPTED_SIMULATED"
    assert e2.db.execute("SELECT order_id FROM signal_inbox").fetchone()[0]==old
    assert b._db.execute("SELECT count(*) FROM paper_orders").fetchone()[0]==1
    e2.close()


def test_broker_storage_exception_pauses_decisions(rig):
    e,b,c,_=rig
    e.enqueue(signal(c,key="fail"))
    b.close()
    ready(e,c)
    assert e.snapshot()["mode"]=="DEGRADED"
    assert e.snapshot()["signals"]=={"RETRY":1}


def test_source_failover_requires_explicit_opt_in(rig):
    e,b,c,_=rig
    assert e.cycle(quote(c,1,source="standby"))["reason"]=="UNAPPROVED_SOURCE"


def test_synthetic_metrics_with_drawdown():
    trades=[SimulatedExit("a","BUY",D("4000"),D("4010"),D(".01")),
            SimulatedExit("b","BUY",D("4000"),D("3990"),D(".01")),
            SimulatedExit("c","SELL",D("4000"),D("3995"),D(".01"))]
    m=evaluate(trades,continuity_cycles=10,degraded_cycles=2)
    assert m["wins"]==2 and m["losses"]==1
    assert m["net_pnl_usd"]=="5.0000"
    assert m["win_rate_pct"]=="66.6667" and m["profit_factor"]=="1.5000"
    assert m["healthy_cycle_pct"]=="80.0000" and m["slippage"]=="NOT_MEASURED"


def test_missing_data_never_claims_winning_probability(tmp_path):
    assert evaluate([])["win_rate_pct"] is None
    with pytest.raises(ValueError):
        evaluate([SimulatedExit("a","BUY",D("1"),D("2"),D("1"),provenance="real")])
    f=tmp_path/"scenario.json"
    f.write_text('{"provenance":"synthetic","trades":[]}')
    assert replay_file(f)["sample_size"]==0
    f.write_text('{"provenance":"real","trades":[]}')
    with pytest.raises(ValueError):
        replay_file(f)
