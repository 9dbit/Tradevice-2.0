import json,tempfile,unittest,uuid
from pathlib import Path
from types import SimpleNamespace
from v51_terminal_reconciliation import prove_risk_stop,RISK_STOP_MESSAGE
class TerminalProof(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.rid=str(uuid.uuid4());self.identity=['fixture','demo','XAUUSDm',1]
  self.folder=self.root/'logs/arc_v1'/('v51_dashboard_'+self.rid.replace('-',''));self.cycle=self.folder/'cycle_01';self.cycle.mkdir(parents=True)
  self.state={'cycle_id':'1234abcd','state':'COMPLETE_RISK_EXIT','broker_flat_confirmed':True}
  self.manifest=dict(status='SAFETY_STOP',no_new_cycle=True,active_slot=None,error='ArcSafetyError('+repr(RISK_STOP_MESSAGE)+')',identity=self.identity,max_cycles=10,slots=[dict(number=1,cycle_id='1234abcd',state_dir=str(self.cycle),result=dict(cycle_id='1234abcd',outcome='COMPLETE_RISK_EXIT',broker_flat_confirmed=True))])
  self.positions=();self.orders=();self.unresolved=[];self.closed=True
  self.adapter=SimpleNamespace(guard_identity=lambda:None,mt5=SimpleNamespace(positions_get=lambda:self.positions,orders_get=lambda:self.orders),cycle_lifecycle=lambda cid:dict(all_closed=self.closed,entry_deals=[1],exit_deals=[2]))
  self.ledger=lambda p:SimpleNamespace(tail='fixture',unresolved_requests=lambda:self.unresolved)
 def run_proof(self):
  (self.cycle/'arc_state.json').write_text(json.dumps(self.state));(self.folder/'batch_manifest.json').write_text(json.dumps(self.manifest))
  return prove_risk_stop(self.root,self.rid,self.adapter,self.ledger,self.identity)
 def test_completed_risk_exit_is_proved(self):self.assertTrue(self.run_proof()['broker_flat'])
 def test_positions_block(self):
  self.positions=(1,)
  with self.assertRaises(ValueError):self.run_proof()
 def test_unavailable_book_blocks(self):
  self.orders=None
  with self.assertRaises(ValueError):self.run_proof()
 def test_pending_orders_block(self):
  self.orders=(1,)
  with self.assertRaises(ValueError):self.run_proof()
 def test_partial_history_blocks(self):
  self.closed=False
  with self.assertRaises(ValueError):self.run_proof()
 def test_unresolved_requests_block(self):
  self.unresolved=[1]
  with self.assertRaises(ValueError):self.run_proof()
 def test_other_exception_blocks(self):
  self.manifest['error']='RuntimeError()'
  with self.assertRaises(ValueError):self.run_proof()
 def test_active_cycle_blocks(self):
  self.manifest['active_slot']=1
  with self.assertRaises(ValueError):self.run_proof()
 def test_identity_mismatch_blocks(self):
  self.manifest['identity']=['wrong']
  with self.assertRaises(ValueError):self.run_proof()
 def test_mismatched_cycle_blocks(self):
  self.state['cycle_id']='other'
  with self.assertRaises(ValueError):self.run_proof()
 def test_unfinished_state_blocks(self):
  self.state['broker_flat_confirmed']=False
  with self.assertRaises(ValueError):self.run_proof()
 def test_rollback_not_promoted(self):
  self.state['state']='COMPLETE_ROLLBACK';self.manifest['slots'][0]['result']['outcome']='COMPLETE_ROLLBACK'
  with self.assertRaises(ValueError):self.run_proof()
if __name__=='__main__':unittest.main()
