"""Real reduction adapter against synthetic MT5 only."""
import sys,time,uuid,json,shutil
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace as NS
import pytest,unittest
from test_v51_dynamic_atr import Engine
from goldtrap_arc.models import Side
from goldtrap_arc.config import ArcSafetyError
from goldtrap_arc.mt5_adapter import ArcUncertainRequest
from goldtrap_arc.persistence import ArcLedger,ArcStateStore
from v51_emergency_close import EmergencyAdapter,reduce_owned,history_proof
from v51_batch_core import broker_batch_stop
class Emergency(unittest.TestCase):
 setUp=Engine.setUp
 def armed(self,fill=True):
  self.engine.step()
  if fill:self.api.fill_layer(1,Side.SELL)
  self.cid=self.engine.state['cycle_id'];self.e=EmergencyAdapter(self.api,allow_execution=True)
  self.e.broker_lock=self.lock;self.e.expires_ms=int(self.now*1000)+60000
  self.e.known_cycles={self.cid};self.e.cycle_catalog={self.cid:(Path(self.tmp.name),self.ledger,self.engine.state)}
  self.el=ArcLedger(Path(self.tmp.name)/'emergency');self.el.initialize();self.e.bind_persistence(self.el,ArcStateStore(Path(self.tmp.name)/'emergency'))
  self.e.initialize();self.events=[];self.before=len(self.api.sent)
 def run_close(self):return reduce_owned(self.e,{self.cid},self.el,self.e.expires_ms,lambda *p:self.events.append(p),sleep=lambda _:None)
 def test_cancel_all_then_close_and_double_flat(self):
  self.armed();old_tail=self.ledger.tail;touched=self.run_close()
  assert not self.api.positions and not self.api.orders and touched[self.cid]
  requests=self.api.sent[self.before:]
  assert [r['action'] for r in requests]==[self.api.TRADE_ACTION_REMOVE]*9+[self.api.TRADE_ACTION_DEAL]
  assert all('position' in r for r in requests if r['action']==self.api.TRADE_ACTION_DEAL)
  assert [p[0] for p in self.events][-2:]==['VERIFYING_FLAT','VERIFYING_FLAT']
  assert not self.el.unresolved_requests() and self.ledger.tail==old_tail
 def test_cancellation_fill_race_is_closed_after_refresh(self):
  self.armed(False);original=self.api.order_check;once=[False]
  def check(r):
   if r['action']==self.api.TRADE_ACTION_REMOVE and not once[0]:once[0]=True;self.api.fill_layer(1,Side.BUY)
   return original(r)
  self.api.order_check=check
  self.run_close();assert not self.api.positions and not self.api.orders
 def test_unknown_result_never_blindly_resends(self):
  self.armed();self.api.order_send=lambda req:(self.api.sent.append(dict(req)) or None)
  with self.assertRaises(ArcUncertainRequest):self.run_close()
  assert len(self.api.sent)==self.before+1 and self.el.unresolved_requests()
 def test_unowned_exposure_no_write(self):
  self.armed();self.api.positions[0].magic=123
  with self.assertRaises(ArcSafetyError):self.run_close()
  assert len(self.api.sent)==self.before
 def test_namespace_without_creation_intent_no_write(self):
  self.armed();self.e.cycle_catalog[self.cid]=(None,NS(rows=[]),{})
  with self.assertRaises(ArcSafetyError):self.run_close()
  assert len(self.api.sent)==self.before
 def test_deadline_during_check_prevents_dispatch(self):
  self.armed();self.api.order_check=lambda r:(setattr(self.e,'expires_ms',0) or NS(retcode=0))
  with self.assertRaisesRegex(ArcSafetyError,'EXPIRED'):self.run_close()
  assert len(self.api.sent)==self.before and not self.el.unresolved_requests()
 def test_entry_operation_is_impossible(self):
  self.armed()
  with self.assertRaisesRegex(ArcSafetyError,'REDUCTION_ONLY'):self.e._write({},operation='ADAPTIVE_MARKET')
  assert len(self.api.sent)==self.before
 def test_missing_history_never_proves_closed(self):
  self.armed();pid=self.api.positions[0].ticket;self.run_close()
  # Real MT5 deals include symbol; enrich synthetic fixtures consistently.
  for d in self.api.deals:d.symbol='XAUUSDm'
  proof=history_proof(self.e,self.cid,[pid]);assert proof['positions_closed']==1
  self.api.deals=[]
  with self.assertRaisesRegex(ValueError,'INCOMPLETE'):history_proof(self.e,self.cid,[pid])
 def test_unrelated_rejection_still_stops_outer_batch(self):
  row=dict(request_id='r',classification='DEFINITIVE_REJECT',retcode=10013)
  assert broker_batch_stop([row],[row])
  history=[row,dict(request_id='r',event='BROKER_REQUEST_INTENT',operation='PENDING_MODIFY'),dict(request_id='r',resolution='PROVEN_NO_EFFECT_AFTER_REJECT'),dict(request_id='r',event='PENDING_TRANSITION_DEFERRED')]
  assert not broker_batch_stop([row],history)
  for i in range(1,len(history)):assert broker_batch_stop([row],history[:i]+history[i+1:])
  assert broker_batch_stop([dict(resolution='PARTIAL_EFFECT')],history)
 def test_full_executor_cancellation_proof_survives_next_intent(self):
  from v51_emergency_close import execute,cancelled_only_proof
  from emergency_state import begin,read
  self.armed(False);root=Path(self.tmp.name);folder=root/'logs/arc_v1/cycle';folder.mkdir(parents=True)
  for name in ('arc_state.json','arc_ownership.jsonl'):
   shutil.copyfile(root/name,folder/name)
  # Synthetic API only; release fixture lock so executor acquires the real OS lock.
  self.lock.__exit__(None,None,None);self.api.shutdown=lambda:None
  rid=str(uuid.uuid4());expiry=int(self.now*1000)+60000;begin(root,rid,expiry)
  with patch.dict(sys.modules,{'MetaTrader5':self.api}):result=execute(root,rid,expiry,None,lambda:None)
  assert result['broker_flat'] is True and read(root)['phase']=='COMPLETE'
  assert not self.api.orders and not self.api.positions
  ledger=ArcLedger(folder);life={'entry_deals':[],'exit_deals':[]}
  assert cancelled_only_proof(root,folder/'arc_state.json',ledger,life)
  begin(root,str(uuid.uuid4()),expiry)
  assert cancelled_only_proof(root,folder/'arc_state.json',ledger,life)
  ledger.append('SYNTHETIC_CHANGED')
  assert not cancelled_only_proof(root,folder/'arc_state.json',ledger,life)
 def test_handoff_during_check_resolves_undispatched_entry(self):
  from v51_guarded_engine import NewsGuardedArcExecutionEngine
  from emergency_state import EmergencyHandoff
  closing=[False]
  engine=NewsGuardedArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg,fixed_arming='PREARM_BOTH',news_provider=lambda:dict(status='CLEAR',entries_allowed=True))
  self.api.order_check=lambda r:(closing.__setitem__(0,True) or NS(retcode=0))
  with patch('v51_guarded_engine.emergency_requested',side_effect=lambda _:closing[0]):
   with self.assertRaises(EmergencyHandoff):engine.step()
  assert not self.api.sent and not self.ledger.unresolved_requests() and not engine.state.get('safety_paused')
if __name__=='__main__':unittest.main()
