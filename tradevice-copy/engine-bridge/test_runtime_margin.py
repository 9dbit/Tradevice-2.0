"""Preflight classification with all MT5 operations mocked; no broker writes."""
import sys,tempfile,types,unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
from v51_dashboard_runtime import Runtime

class SafetyError(RuntimeError):pass

class MarginPreflight(unittest.TestCase):
 def run_preflight(self,error=None):
  adapter=Mock()
  adapter.identity.return_value=(NS(trade_mode=0,server='Exness-MT5Trial14'),None,NS(name='XAUUSDm'))
  adapter.quote_metrics.return_value={'fresh':True}
  adapter.spread_points.return_value=240
  adapter.cfg=NS(spread_limit_points=300,magic=8802001)
  adapter._raw_history.return_value=([NS(symbol='XAUUSDm',magic=8802001,type=1,commission=0,fee=0)],[])
  factory=Mock(return_value=adapter)
  margin=Mock(side_effect=error,return_value={'free_margin':1000})
  mt5=NS(ACCOUNT_TRADE_MODE_DEMO=0,positions_get=lambda:[],orders_get=lambda:[],shutdown=Mock())
  modules={'MetaTrader5':mt5,'goldtrap_arc':types.ModuleType('goldtrap_arc'),
   'goldtrap_arc.config':NS(ArcSafetyError=SafetyError),
   'goldtrap_arc.mt5_adapter':NS(MT5ArcAdapter=factory),
   'goldtrap_arc.persistence':NS(ArcLedger=Mock(),ArcStateStore=Mock()),
   'v51_batch_research':NS(margin_envelope=margin)}
  with tempfile.TemporaryDirectory() as tmp,patch.dict(sys.modules,modules),patch('v51_dashboard_runtime.configure_adapter'):
   runtime=Runtime.__new__(Runtime);runtime.root=Path(tmp)
   runtime.fingerprint=Mock();runtime.reconcile_prior=Mock()
   runtime.calendar=NS(decision=lambda:{'status':'CLEAR','entries_allowed':True})
   checks,blockers=runtime.preflight()
   self.assertEqual(factory.call_args.kwargs,{'allow_execution':False})
   self.assertTrue(checks['brokerFlat']);self.assertTrue(checks['reconciled'])
   self.assertEqual(runtime.checks(),checks)
   mt5.shutdown.assert_called_once()
   margin.assert_called_once_with(adapter)
   return checks,blockers
 def test_verified_shortfall_remains_blocked(self):
  checks,blockers=self.run_preflight(SafetyError('RESEARCH_MARGIN_ENVELOPE_INSUFFICIENT'))
  self.assertFalse(checks['margin'])
  self.assertEqual(blockers,['MARGIN_ENVELOPE_INSUFFICIENT','PREFLIGHT_MARGIN'])
 def test_unknown_errors_are_not_reported_as_shortfalls_or_leaked(self):
  for error in [SafetyError('RESEARCH_NONFINITE_ECONOMICS'),RuntimeError('private broker detail'),RuntimeError('RESEARCH_MARGIN_ENVELOPE_INSUFFICIENT')]:
   with self.subTest(error=type(error).__name__):
    checks,blockers=self.run_preflight(error)
    self.assertFalse(checks['margin'])
    self.assertEqual(blockers,['MARGIN_ENVELOPE_UNVERIFIED','PREFLIGHT_MARGIN'])
 def test_success_still_requires_actual_margin_check(self):
  checks,blockers=self.run_preflight()
  self.assertTrue(checks['margin']);self.assertEqual(blockers,[])

if __name__=='__main__':unittest.main()
