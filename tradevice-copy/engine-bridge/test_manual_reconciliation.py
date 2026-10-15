"""Synthetic broker history; a flat book alone never clears recovery."""
import json,uuid
from types import SimpleNamespace as NS
import pytest
from v51_manual_reconciliation import prove_manual_stop,MANUAL_STOP_ERROR
@pytest.fixture
def manual(tmp_path):
 rid=str(uuid.uuid4());folder=tmp_path/'logs/arc_v1'/('v51_dashboard_'+rid.replace('-',''));cycle=folder/'cycle_01';cycle.mkdir(parents=True)
 (cycle/'arc_state.json').write_text(json.dumps(dict(cycle_id='abcdef12',state='SAFETY_PAUSED',safety_paused=True,block_next_cycle=True)))
 (cycle/'arc_ownership.jsonl').write_text('unchanged fixture')
 (folder/'batch_manifest.json').write_text(json.dumps(dict(status='SAFETY_STOP',error=MANUAL_STOP_ERROR,identity=['fixture'],active_slot=1,slots=[dict(number=1,cycle_id='abcdef12',state_dir=str(cycle),result={'outcome':'SAFETY_STOP'})])))
 entry=NS(ticket=1,position_id=7,entry=0,volume=.01,price=4100,magic=8802001,symbol='XAUUSDm',comment='GT_ARC_V1:abcdef12:B01',profit=0)
 exit=NS(ticket=2,position_id=7,entry=1,volume=.01,price=4108.96,symbol='XAUUSDm',reason=0,profit=8.96)
 life=dict(all_closed=True,entry_deals=[entry],exit_deals=[exit],net_pl=8.96)
 a=NS(cfg=NS(magic=8802001),guard_identity=lambda:None,mt5=NS(positions_get=lambda:[],orders_get=lambda:[]),cycle_lifecycle=lambda cid:life)
 ledger=lambda directory:NS(tail='stable',unresolved_requests=lambda:[])
 return tmp_path,rid,a,ledger,['fixture'],life,folder

def prove(f):return prove_manual_stop(*f[:5])
def test_manual_net_leaves_files_unchanged(manual):
 x=prove(manual);assert x['net_usd']==8.96;assert x['positions_closed']==1;assert x['orders_sent']==0;assert x['original_journals_modified'] is False
@pytest.mark.parametrize('kind',['partial','overclosed','foreign','notmanual','notflat','unresolved','notclosed','changed'])
def test_refuses_incomplete_or_ambiguous_evidence(manual,kind):
 root,rid,a,ledger,identity,life,folder=manual
 if kind=='partial':life['exit_deals'][0].volume=.005
 if kind=='overclosed':life['exit_deals'][0].volume=.02
 if kind=='foreign':life['entry_deals'][0].magic=0
 if kind=='notmanual':life['exit_deals'][0].reason=5
 if kind=='notflat':a.mt5.orders_get=lambda:[object()]
 if kind=='unresolved':manual=(*manual[:3],lambda d:NS(tail='stable',unresolved_requests=lambda:[{}]),*manual[4:])
 if kind=='notclosed':life['all_closed']=False
 if kind=='changed':
  def history(cid):
   (folder/'cycle_01/arc_state.json').write_text('{}');return life
  a.cycle_lifecycle=history
 with pytest.raises(ValueError):prove(manual)
