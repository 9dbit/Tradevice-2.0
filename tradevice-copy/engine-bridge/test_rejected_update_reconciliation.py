"""No terminal access; the exact stopped basket must be proved independently."""
import json,uuid
from types import SimpleNamespace as NS
import pytest
from v51_rejected_update_reconciliation import prove_rejected_update_stop,STOP_ERROR

@pytest.fixture
def stopped(tmp_path):
 rid=str(uuid.uuid4());folder=tmp_path/'logs/arc_v1'/('v51_dashboard_'+rid.replace('-',''));cycle=folder/'cycle_01';cycle.mkdir(parents=True)
 state=dict(cycle_id='abcdef12',state='SAFETY_PAUSED',safety_paused=True,block_next_cycle=True,paused_broker_tp_verified=True,paused_pending_count=0)
 manifest=dict(status='SAFETY_STOP',error=STOP_ERROR,identity=['fixture'],active_slot=1,no_new_cycle=True,cleanup_status='PROTECTED',slots=[dict(number=1,cycle_id='abcdef12',state_dir=str(cycle),result={'outcome':'SAFETY_STOP'})])
 (cycle/'arc_state.json').write_text(json.dumps(state));(folder/'batch_manifest.json').write_text(json.dumps(manifest))
 entry=NS(ticket=1,position_id=7,entry=0,type=1,reason=3,volume=.01,price=4154.069,magic=8802001,symbol='XAUUSDm',comment='GT_ARC_V1:abcdef12:S01',profit=0)
 exit=NS(ticket=2,position_id=7,entry=1,type=0,volume=.01,price=4151.970,symbol='XAUUSDm',magic=8802001,reason=5,profit=2.1)
 life=dict(all_closed=True,entry_deals=[entry],exit_deals=[exit],net_pl=2.1)
 rows=[dict(event='BROKER_REQUEST_INTENT',request_id='bad',operation='PENDING_MODIFY',cycle_id='abcdef12'),dict(event='BROKER_REQUEST_RECEIPT',request_id='bad',retcode=10013),dict(event='BROKER_REQUEST_RESOLVED',request_id='bad',resolution='PROVEN_NO_EFFECT_AFTER_REJECT'),dict(event='BROKER_REQUEST_INTENT',request_id='tp',operation='TP_SYNC',target_ticket=7,expected_tp=4151.970),dict(event='BROKER_REQUEST_RESOLVED',request_id='tp',resolution='EFFECT_PROVEN')]
 a=NS(cfg=NS(magic=8802001,tick_size=.001),guard_identity=lambda:None,mt5=NS(positions_get=lambda:[],orders_get=lambda:[]),cycle_lifecycle=lambda cid:life)
 ledger=lambda d:NS(rows=rows,tail='stable',unresolved_requests=lambda:[])
 return tmp_path,rid,a,ledger,['fixture'],life,folder,rows

def test_exact_tp_proof_preserves_journals(stopped):
 proof=prove_rejected_update_stop(*stopped[:5]);assert proof['net_usd']==2.1;assert proof['outcome']=='COMPLETE_BROKER_TP_RECONCILED';assert proof['orders_sent']==0

@pytest.mark.parametrize('fault',['partial','excess','manual','wrongprice','foreign','open','unknown','unresolved','noeffect','unprotected','changed','differenterror'])
def test_unsafe_or_incomplete_proof_fails(stopped,fault):
 root,rid,a,ledger,identity,life,folder,rows=stopped
 if fault=='partial':life['exit_deals'][0].volume=.005
 if fault=='excess':life['exit_deals'][0].volume=.02
 if fault=='manual':life['exit_deals'][0].reason=0
 if fault=='wrongprice':life['exit_deals'][0].price+=.01
 if fault=='foreign':life['entry_deals'][0].magic=0
 if fault=='open':a.mt5.positions_get=lambda:[1]
 if fault=='unknown':a.mt5.orders_get=lambda:None
 if fault=='unresolved':ledger=lambda d:NS(rows=rows,tail='stable',unresolved_requests=lambda:[{}])
 if fault=='noeffect':rows[2]['resolution']='UNCERTAIN'
 if fault=='unprotected':rows[-1]['resolution']='UNCONFIRMED'
 if fault=='changed':
  def history(cid):
   (folder/'cycle_01/arc_state.json').write_text('{}');return life
  a.cycle_lifecycle=history
 if fault=='differenterror':
  f=folder/'batch_manifest.json';m=json.loads(f.read_text());m['error']='RuntimeError()';f.write_text(json.dumps(m))
 with pytest.raises(ValueError):prove_rejected_update_stop(root,rid,a,ledger,identity)
