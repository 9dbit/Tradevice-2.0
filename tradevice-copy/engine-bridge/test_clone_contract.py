"""Run with unittest on TRADEVICEPC. All adapters here are synthetic; no MT5 writes."""
import json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch,MagicMock
import v51_batch_core as core
from v51_dashboard_runtime import Runtime
class BoundedRunner(unittest.TestCase):
 def manifest(self,n):return dict(identity=list(core.IDENTITY),max_cycles=n,spec_sha256=core.SPEC_SHA256,execution_contract=core.CONTRACT,fixed_arming='PREARM_BOTH',status='RUNNING',slots=[],active_slot=None)
 def test_bounded_cycle_limit(self):
  for n in (1,3,10):core.validate_manifest(self.manifest(n))
  for n in (0,11,True,1.5):
   with self.assertRaises(core.ArcSafetyError):core.validate_manifest(self.manifest(n))
 def test_limit_one_never_reserves_second_cycle(self):
  with tempfile.TemporaryDirectory() as tmp:
   m=self.manifest(1);core.reserve_slot(m,Path(tmp));m['active_slot']=None;m['slots'][0]['result']={'broker_flat_confirmed':True}
   with self.assertRaises(core.ArcSafetyError):core.reserve_slot(m,Path(tmp))
 def test_unreconciled_previous_cycle_blocks_reservation(self):
  with tempfile.TemporaryDirectory() as tmp:
   m=self.manifest(3);core.reserve_slot(m,Path(tmp));m['active_slot']=None
   with self.assertRaises(core.ArcSafetyError):core.reserve_slot(m,Path(tmp))
class PriorProof(unittest.TestCase):
 def check(self,closed=True,unresolved=False,flat=True):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'logs'/'arc_v1'/'old'/'arc_state.json';p.parent.mkdir(parents=True);p.write_text('{"untouched":true}');(root/'read_only').mkdir()
   r=Runtime.__new__(Runtime);r.root=root
   a=SimpleNamespace(guard_identity=lambda:None,mt5=SimpleNamespace(positions_get=lambda:() if flat else (object(),),orders_get=lambda:()),cycle_lifecycle=lambda cid:dict(all_closed=closed,entry_deals=[1],exit_deals=[2]))
   ledger=SimpleNamespace(tail='test-hash',unresolved_requests=lambda:[1] if unresolved else [])
   with patch('goldtrap_arc.persistence.ArcLedger',return_value=ledger),patch('goldtrap_arc.persistence.ArcStateStore') as store:
    store.return_value.load.return_value=dict(cycles_started=1,state='SAFETY_PAUSED',cycle_id='test')
    if closed and not unresolved and flat:
     self.assertEqual(len(r.reconcile_prior(a)),1)
     proof=json.loads((root/'read_only'/'dashboard_prior_reconciliation.json').read_text());self.assertFalse(proof['original_journals_modified']);self.assertFalse(proof['counted_in_new_run'])
    else:
     with self.assertRaises(ValueError):r.reconcile_prior(a)
    self.assertEqual(p.read_text(),'{"untouched":true}')
 def test_closed_history_is_separate_proof(self):self.check()
 def test_partial_history_blocks(self):self.check(closed=False)
 def test_unresolved_request_blocks(self):self.check(unresolved=True)
 def test_exposure_blocks(self):self.check(flat=False)
if __name__=='__main__':unittest.main()
