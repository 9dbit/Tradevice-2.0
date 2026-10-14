import copy,json
from app.demo_batch import project_batch
from app.observer_telemetry import ObserverBuffer
from test_observer_telemetry import fixture,NOW

def batch():return dict(schema='tradevice.v51.demo.batch.v1',read_only=True,batch_id='fixture-demo10',observed_ms=NOW,status='RUNNING',requested=10,blockers=[],cycles=[])
def cycle(n=1):return dict(number=n,cycle_id=f'fixture-{n}',outcome='COMPLETE_TARGET_HISTORY',broker_flat=True,layers=2,peak_lots=.03,net_usd=3.5)
def test_derived_counts_ignore_reported_wins():
 b=batch();b.update(wins=999,completed=10,cycles=[cycle(),dict(cycle(2),outcome='SAFETY_STOP',broker_flat=False,net_usd=-8)])
 p=project_batch(b,NOW);assert (p['completed'],p['wins'],p['unfinished'],p['net_completed_usd'])==(1,1,1,3.5)
def test_empty_retired_cycle_not_a_win():
 b=batch();b['cycles']=[dict(cycle(),layers=0,net_usd=0,outcome='COMPLETE_NEWS_RETIRED')]
 assert project_batch(b,NOW)['completed']==0

def test_rejects_bad_proof_and_over_limit():
 for change in [dict(broker_flat=False),dict(net_usd=None),dict(net_usd=float('nan')),dict(layers=11)]:
  b=batch();b['cycles']=[dict(cycle(),**change)];assert project_batch(b,NOW) is None
 b=batch();b['cycles']=[cycle(n) for n in range(1,12)];assert project_batch(b,NOW) is None
 b['cycles']=[cycle(),cycle()];assert project_batch(b,NOW) is None
 b=batch();b['status']='COMPLETED';assert project_batch(b,NOW) is None

def test_stale_preserves_historical_label_not_freshness():
 p=project_batch(batch(),NOW+15001);assert p['fresh'] is False
 assert project_batch(batch(),NOW-1001) is None

def test_full_ten_and_risk_math():
 b=batch();b.update(status='COMPLETED',cycles=[cycle(n) for n in range(1,11)])
 p=project_batch(b,NOW);assert p['completed']==10 and p['net_completed_usd']==35
 b['cycles'][-1].update(outcome='COMPLETE_RISK',net_usd=-120.8)
 p=project_batch(b,NOW);assert (p['risk_exits'],p['losses'],p['net_completed_usd'])==(1,1,-89.3)

def test_packet_batch_ack_and_size():
 report=batch();report['cycles']=[cycle(n) for n in range(1,11)]
 encoded=fixture(demo_batch=report);assert len(encoded)<=8192
 b=ObserverBuffer();p=b.receive(encoded,NOW);assert p['completed']==10
 assert b.market(NOW)['demoBatch']['batch_id']=='fixture-demo10'
 assert b.market(NOW+10000)['demoBatch'] is None
