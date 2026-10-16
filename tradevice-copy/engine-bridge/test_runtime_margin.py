"""Preflight classification with all MT5 operations mocked; no broker writes."""
import sys,tempfile,types,unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
from v51_dashboard_runtime import Runtime

class SafetyError(RuntimeError):pass

class MarginPreflight(unittest.TestCase):
 def run_preflight(self,error=None,market=None):
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
  with tempfile.TemporaryDirectory() as tmp,patch.dict(sys.modules,modules),patch('v51_dashboard_runtime.configure_adapter'),patch('v51_dashboard_runtime.inspect_market',return_value=market or ({'atr':True,'adx':True},[],None)):
   runtime=Runtime.__new__(Runtime);runtime.root=Path(tmp)
   runtime.fingerprint=Mock();runtime.reconcile_prior=Mock()
   runtime.calendar=NS(decision=lambda:{'status':'CLEAR','entries_allowed':True})
   checks,blockers=runtime.preflight()
   self.assertEqual(factory.call_args.kwargs,{'allow_execution':False})
   self.assertTrue(checks['brokerFlat']);self.assertTrue(checks['reconciled'])
   self.assertEqual(runtime.checks(),checks)
   mt5.shutdown.assert_called_once()
   self.assertEqual(margin.call_args.args,(adapter,))
   self.assertIn('evidence',margin.call_args.kwargs)
   evidence=runtime.preflight_evidence()
   self.assertEqual(evidence['checks'],checks)
   self.assertEqual(evidence['blockers'],blockers)
   self.assertEqual(evidence['settings']['baseLot'],.01)
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
 def test_market_failure_does_not_poison_other_checks(self):
  checks,blockers=self.run_preflight(market=({'atr':True,'adx':False},['ADX_TREND_NOT_RANGING'],None))
  self.assertTrue(checks['atr']);self.assertFalse(checks['adx']);self.assertTrue(checks['margin'])
  self.assertEqual(blockers,['ADX_TREND_NOT_RANGING','PREFLIGHT_ADX'])
 def test_success_still_requires_actual_margin_check(self):
  checks,blockers=self.run_preflight()
  self.assertTrue(checks['margin']);self.assertEqual(blockers,[])

if __name__=='__main__':unittest.main()

class MarginEvidenceCalculation(unittest.TestCase):
 def test_exact_broker_numbers_survive_insufficient_exception(self):
  from v51_batch_research import margin_envelope
  from goldtrap_arc.config import CONFIG,ArcSafetyError
  from dataclasses import replace
  cfg=replace(CONFIG,base_lot=.1,hard_basket_loss_usd=-250,adaptive_risk_reserve_usd=15)
  account=NS(currency='USD',margin_free=2000.,margin=100.)
  adapter=NS(cfg=cfg,identity=lambda:(account,None,NS(name='XAUUSDm')),
   snapshot=lambda:NS(tick=NS(ask=4000.,bid=3999.8)),
   mt5=NS(ORDER_TYPE_BUY=0,ORDER_TYPE_SELL=1,order_calc_margin=Mock(return_value=400.)))
  evidence={}
  with self.assertRaisesRegex(ArcSafetyError,'RESEARCH_MARGIN_ENVELOPE_INSUFFICIENT'):margin_envelope(adapter,evidence=evidence)
  self.assertEqual(evidence['requiredFreeMargin'],6265.)
  self.assertEqual(evidence['minimumEquity'],6365.)
  self.assertEqual(evidence['shortfall'],4265.)
  self.assertEqual(adapter.mt5.order_calc_margin.call_count,20)
  account.margin_free=6265.
  self.assertEqual(margin_envelope(adapter,evidence=evidence)['reserve'],265.)
  self.assertEqual(evidence['shortfall'],0.)
  adapter.mt5.order_calc_margin.return_value=None;evidence={}
  with self.assertRaises(ArcSafetyError):margin_envelope(adapter,evidence=evidence)
  self.assertEqual(evidence,{})
