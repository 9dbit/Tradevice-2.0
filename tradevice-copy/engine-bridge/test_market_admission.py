"""Run the real batch coordinator with mocked broker/engine dispatch."""
import tempfile
import unittest
from contextlib import ExitStack, nullcontext
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch
import v51_batch_core as core

class MarketAdmission(unittest.TestCase):
 def run_case(self, decisions, flat_error=None):
  with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
   root=Path(tmp)/'batch';adapter=Mock();adapter.cycle_lifecycle.return_value={'all_closed':True}
   ledger=Mock();ledger.rows=[];ledger.unresolved_requests.return_value=[]
   engine=Mock();engine.state={'state':'COMPLETE_TARGET','cycle_id':'fixture','broker_flat_confirmed':True}
   engine.step.return_value='COMPLETE_TARGET';engine.ledger=ledger
   factory=Mock(return_value=engine);admission=Mock(side_effect=decisions);reports=[]
   slot={'number':1,'cycle_id':'fixture','state_dir':str(root/'cycle_01'),'layers':1,'side':'BUY','reserved_at':'fixture'}
   def reserve(m,root):
    m['slots'].append(slot);m['active_slot']=1;return slot
   result={'layers':1,'cycle_id':'fixture','outcome':'COMPLETE_TARGET','realized_pl_usd':3.5}
   for name,value in [('verify_spec',Mock()),('ArcRunnerLock',Mock(return_value=nullcontext(NS(path='fixture')))),('account_book',Mock(side_effect=flat_error)),('ArcStateStore',Mock()),('ArcLedger',Mock(return_value=ledger)),('atomic_json',Mock()),('validate_manifest',Mock()),('reserve_slot',Mock(side_effect=reserve)),('sample',Mock(return_value=False)),('summarize',Mock(return_value=result)),('broker_batch_stop',Mock(return_value=False))]:
    stack.enter_context(patch.object(core,name,value))
   value=core.run(root,False,NS(shutdown=Mock()),fixed_arming='PREARM_BOTH',adapter_class=Mock(return_value=adapter),admission=admission,reporter=lambda m,*a,**k:reports.append(dict(m)),engine_class=factory,cycle_limit=2,prior_reconciliation=lambda a:set())
   adapter.mt5.order_send.assert_not_called()
   return value,admission,factory,reports
 def test_first_rejection_never_creates_engine(self):
  value,admission,engine,reports=self.run_case([False])
  self.assertEqual(value,0);engine.assert_not_called();self.assertEqual(reports,[])
 def test_next_cycle_rejection_is_graceful_after_completed_cycle(self):
  value,admission,engine,reports=self.run_case([None,None,False])
  self.assertEqual(value,0);self.assertEqual(admission.call_count,3);engine.assert_called_once()
  self.assertEqual(reports[-1]['status'],'STOPPED_ENTRY_PREFLIGHT')
  self.assertEqual(len(reports[-1]['slots']),1);self.assertTrue(reports[-1]['no_new_cycle']);self.assertIsNone(reports[-1]['active_slot'])
 def test_false_admission_does_not_override_unproved_flat(self):
  with self.assertRaisesRegex(ValueError,'NOT_FLAT'):self.run_case([False],ValueError('NOT_FLAT'))

if __name__=='__main__':unittest.main()
