import json
from datetime import datetime,timezone
from viewer import capture,render
NOW=1792000000000;BATCH='v51_dashboard_'+'a'*32

def prepare(tmp_path):
 (tmp_path/'read_only').mkdir();(tmp_path/'read_only/demo_batch.json').write_text(json.dumps({'batch_id':BATCH}))
 base=tmp_path/'logs/arc_v1'/BATCH/'cycle_01';base.mkdir(parents=True)
 return base/'arc_ownership.jsonl'
def test_reader_filters_sensitive_payload_unknown_events_and_partial_appends(tmp_path):
 path=prepare(tmp_path)
 row=dict(timestamp=datetime.fromtimestamp((NOW-5000)/1000,timezone.utc).isoformat(),event='CYCLE_STARTED',cycle_id='1234abcd',sequence=1,members={'account':'PRIVATE','password':'SECRET'})
 path.write_text(json.dumps(row)+'\n'+json.dumps({**row,'event':'RAW_PASSWORD','sequence':2})+'\n'+json.dumps({**row,'sequence':3}))
 p=capture(tmp_path,NOW)
 assert p['status']=='LIVE' and len(p['lines'])==1
 assert 'PRIVATE' not in json.dumps(p) and 'SECRET' not in render(p)
 assert 'WIB  1234abcd  CYCLE_STARTED  #1' in render(p)
def test_reader_refuses_path_traversal_and_symlink_escape(tmp_path):
 path=prepare(tmp_path);path.symlink_to(tmp_path/'outside.jsonl');(tmp_path/'outside.jsonl').write_text('{}\n')
 assert capture(tmp_path,NOW)['status']=='UNAVAILABLE'
 (tmp_path/'read_only/demo_batch.json').write_text(json.dumps({'batch_id':'../../outside'}))
 assert capture(tmp_path,NOW)['lines']==[]
def test_missing_source_never_invents_events(tmp_path):
 assert capture(tmp_path,NOW)['status']=='UNAVAILABLE'

def test_receipts_keep_cycle_namespace_across_journals(tmp_path):
 path=prepare(tmp_path)
 def rows(cycle):
  a=dict(timestamp=datetime.fromtimestamp((NOW-5000)/1000,timezone.utc).isoformat(),event='CYCLE_STARTED',cycle_id=cycle,sequence=1)
  return json.dumps(a)+'\n'+json.dumps({**a,'cycle_id':None,'event':'BROKER_REQUEST_RECEIPT','sequence':2})+'\n'
 path.write_text(rows('1234abcd'))
 other=path.parent.parent/'cycle_02/arc_ownership.jsonl';other.parent.mkdir();other.write_text(rows('5678abcd'))
 p=capture(tmp_path,NOW)
 assert len(p['lines'])==4
 assert {e['cycle'] for e in p['lines'] if e['event']=='BROKER_REQUEST_RECEIPT'}=={'1234abcd','5678abcd'}
