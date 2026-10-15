"""Integration against clone modules, all broker/run operations mocked."""
import unittest,tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from v51_dashboard_runtime import Runtime
from v51_batch_core import ArcSafetyError
from v51_terminal_reconciliation import RISK_STOP_MESSAGE
class Session:
 def __init__(self,bid):self.calendar=SimpleNamespace(close=lambda:None);self.clock=lambda:1;self.last_emit=0
class RuntimeRiskStop(unittest.TestCase):
 def check(self,error,proof_error=False):
  with tempfile.TemporaryDirectory() as tmp:
   r=Runtime.__new__(Runtime);r.root=Path(tmp);r.reason=None;r.calendar=object()
   with patch('v51_demo_batch_runtime.Session',Session),patch('v51_batch_core.run',side_effect=error),patch('v51_batch_telemetry.publish'),patch('goldtrap_arc.mt5_adapter.MT5ArcAdapter') as adapter,patch('v51_terminal_reconciliation.prove_risk_stop',side_effect=ValueError('unproved') if proof_error else None) as prove,patch('MetaTrader5.shutdown') as shutdown:
    if str(error)==RISK_STOP_MESSAGE and not proof_error:
     self.assertEqual(r.run('8778cc63-6c81-42d8-b02d-eb1a099117e0',10,lambda:None,1),'RISK_STOP_FLAT')
     self.assertFalse(adapter.call_args.kwargs['allow_execution']);prove.assert_called_once()
    else:
     with self.assertRaises(Exception):r.run('8778cc63-6c81-42d8-b02d-eb1a099117e0',10,lambda:None,1)
    shutdown.assert_called_once()
 def test_known_stop_readonly_proof(self):self.check(ArcSafetyError(RISK_STOP_MESSAGE))
 def test_failed_proof_reraises(self):self.check(ArcSafetyError(RISK_STOP_MESSAGE),True)
 def test_other_error_reraises(self):self.check(ArcSafetyError('other'))
if __name__=='__main__':unittest.main()
