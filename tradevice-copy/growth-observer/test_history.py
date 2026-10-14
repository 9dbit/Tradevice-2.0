import json
from datetime import datetime,timezone
from history import capture
NOW=1792000000000;BATCH='v51_dashboard_'+'a'*32
IDENTITY=[123,'Exness-MT5Trial14','XAUUSDm',8802001]
def iso(ms):return datetime.fromtimestamp(ms/1000,timezone.utc).isoformat()
def prepare(root,batch=BATCH,identity=IDENTITY):
 base=root/'logs/arc_v1'/batch;base.mkdir(parents=True)
 (base/'batch_manifest.json').write_text(json.dumps(dict(identity=identity,started_at=iso(NOW-100000))))
 p=base/'cycle_01';p.mkdir();(p/'cycle_summary.json').write_text(json.dumps(dict(cycle_id='1234abcd',broker_flat_confirmed=True,outcome='COMPLETE_TARGET_HISTORY',layers=2,realized_pl_usd=3.5,start_time=iso(NOW-90000),end_time=iso(NOW-60000),state_dir='PRIVATE')))
 return p/'cycle_summary.json'
def setup(root):
 (root/'read_only').mkdir();(root/'read_only/demo_batch.json').write_text(json.dumps({'batch_id':BATCH}));return prepare(root)
def test_actual_closed_time_net_and_account_isolation(tmp_path):
 setup(tmp_path);prepare(tmp_path,'v51_dashboard_'+'b'*32,[456,*IDENTITY[1:]])
 p=capture(tmp_path,NOW)
 assert p['status']=='AVAILABLE' and p['rows']==[dict(cycleId='1234abcd',closedMs=NOW-60000,netUsd=3.5)]
 assert 'PRIVATE' not in json.dumps(p) and 'identity' not in p
def test_open_and_no_fill_cycles_never_enter_growth(tmp_path):
 path=setup(tmp_path);s=json.loads(path.read_text());s['broker_flat_confirmed']=False;path.write_text(json.dumps(s));assert capture(tmp_path,NOW)['rows']==[]
 s.update(broker_flat_confirmed=True,layers=0);path.write_text(json.dumps(s));assert capture(tmp_path,NOW)['rows']==[]
def test_missing_invalid_time_and_nonfinite_do_not_fabricate_growth(tmp_path):
 assert capture(tmp_path,NOW)['status']=='UNAVAILABLE'
 path=setup(tmp_path);s=json.loads(path.read_text());s['realized_pl_usd']=float('nan');path.write_text(json.dumps(s));assert capture(tmp_path,NOW)['status']=='PARTIAL'
 s.update(realized_pl_usd=4,end_time=iso(NOW+1));path.write_text(json.dumps(s));assert capture(tmp_path,NOW)['rows']==[]
def test_same_cycle_cannot_be_counted_twice_and_conflicts_fail_closed(tmp_path):
 setup(tmp_path);other=prepare(tmp_path,'v51_dashboard_'+'b'*32)
 assert len(capture(tmp_path,NOW)['rows'])==1
 s=json.loads(other.read_text());s['realized_pl_usd']=5;other.write_text(json.dumps(s));assert capture(tmp_path,NOW)['status']=='UNAVAILABLE'
