"""Offline broker regression. Never imports MetaTrader5 or uses live execution."""
import sys,unittest
from pathlib import Path
from dataclasses import replace
from types import SimpleNamespace as NS
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent/'tests'))
import test_goldtrap_arc_pending_execution as legacy
from candidate_tests import test_reversal_risk as candidate
from goldtrap_arc.config import CONFIG,SPEC_SHA256,execution_config,execution_config_proof,verify_spec,ArcSafetyError
from goldtrap_arc.execution import ArcExecutionEngine
from goldtrap_arc.models import Side,Bar
from goldtrap_arc.adaptive_policy import reversal_decision
from v51_demo_batch_runtime import Session
from v51_execution_settings import configure_adapter
from demo_settings import default_settings,validate_settings

class DistanceExecution(unittest.TestCase):
 start=legacy.PendingExecutionTests.start
 fixed_fills=legacy.PendingExecutionTests.fixed_fills
 candle=candidate.CandidateExecution.candle
 entries=candidate.CandidateExecution.entries
 def setUp(self):
  legacy.PendingExecutionTests.setUp(self)
  self.cfg=execution_config(.01,3.5,settings=default_settings())
  self.a.cfg=self.cfg
  self.engine=ArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg,fixed_arming='PREARM_BOTH')
 def prepare(self,side=Side.SELL):
  self.fixed_fills(side);self.side=side;self.anchor=self.api.positions[-1].price_open
  latest=int(self.now)//60*60-60
  self.rows=[dict(time=latest-(14-j)*60,open=self.anchor,high=self.anchor+.1,low=self.anchor-.1,close=self.anchor,spread=240) for j in range(15)]
  self.api.copy_rates_from_pos=lambda *args:self.rows
 def test_waits_as_many_candles_as_needed_then_enters_without_reversal(self):
  self.prepare()
  for distance in [.7,1.2,1.69,1.7]:
   self.candle(distance,False);self.engine.next_entry(self.a.snapshot());self.assertFalse(self.entries())
  self.candle(1.701,False);self.engine.next_entry(self.a.snapshot())
  self.assertEqual(len(self.entries()),1);self.assertEqual(len(self.api.positions),6)
  self.assertEqual(self.store.load()['adaptive_intent']['policy'],'CLOSE_DISTANCE_RISK_V51')
  self.engine.step();self.assertEqual(len(self.entries()),1)
  self.assertTrue(all(p.tp>0 for p in self.api.positions))
 def test_next_anchor_rechecked_and_projection_does_not_block_entry(self):
  self.prepare()
  for layer in (6,7):
   self.anchor=self.api.positions[-1].price_open
   self.candle(1.701,False);self.engine.next_entry(self.a.snapshot())
   self.assertEqual(len(self.api.positions),layer)
   self.assertEqual(self.store.load()['adaptive_intent']['layer'],layer)
  self.anchor=self.api.positions[-1].price_open
  self.candle(1.701,False);self.engine.next_entry(self.a.snapshot())
  self.assertEqual(len(self.api.positions),8)
  risk=[r for r in self.ledger.rows if r['event']=='ADAPTIVE_RISK_EVALUATED'][-1]
  self.assertEqual(risk['selected_lot'],risk['requested_lot'])
  self.assertLess(risk['requested_stress_pl'],risk['threshold'])
 def test_l6_through_l10_have_no_projected_stress_veto(self):
  self.prepare()
  with patch.object(self.a,'executable_pl',return_value=-1):
   for layer in range(6,11):
    self.anchor=self.api.positions[-1].price_open;self.candle(1.701,False);self.engine.next_entry(self.a.snapshot())
    self.assertEqual(len(self.api.positions),layer)
   sent=len(self.api.sent);self.engine.next_entry(self.a.snapshot());self.assertEqual(len(self.api.sent),sent)
  self.assertEqual(len(self.entries()),5)
 def test_diagnostics_do_not_claim_reversal_is_required(self):
  from v51_engine_diagnostics import make_report
  self.prepare();self.candle(1.2,False);self.engine.next_entry(self.a.snapshot())
  report=make_report(self.engine,int(self.now*1000))
  self.assertEqual(report['policy'],'CLOSE_DISTANCE_RISK_V51')
  self.assertEqual(report['decision']['reasons'],['WAIT_CLOSED_M1_BEYOND_1700'])
 def test_buy_is_symmetric_and_anchor_moves_only_after_fill(self):
  self.prepare(Side.BUY);old=self.anchor
  self.candle(1.701,False);self.engine.next_entry(self.a.snapshot())
  self.assertEqual(len(self.entries()),1)
  self.assertEqual(self.entries()[0]['type'],0)
  filled=self.api.positions[-1]
  self.assertNotEqual(filled.price_open,old)
  self.anchor=filled.price_open
  self.candle(1.2,False);self.engine.next_entry(self.a.snapshot())
  self.assertEqual(len(self.entries()),1)
  event=[r for r in self.ledger.rows if r['event']=='REVERSAL_EVALUATED'][-1]
  self.assertEqual(event['anchor_actual_fill'],filled.price_open)
 def test_expired_authorization_cannot_dispatch(self):
  from goldtrap_arc.config import ArcAdaptiveSpreadWait
  self.prepare();self.candle(1.8,False)
  with patch.object(self.a,'adaptive_market',side_effect=ArcAdaptiveSpreadWait('wait')):self.engine.next_entry(self.a.snapshot())
  self.now=self.store.load()['adaptive_intent']['expires_at']
  self.engine.next_entry(self.a.snapshot())
  self.assertFalse(self.entries());self.assertEqual(self.store.load()['adaptive_intent']['status'],'DEFERRED')
 def test_ambiguous_accepted_request_is_reconciled_not_resent(self):
  self.prepare();self.candle(1.8,False)
  def crash(api,request):api._apply(request);raise KeyboardInterrupt('simulated crash')
  self.api.behaviors=[crash]
  with self.assertRaises(KeyboardInterrupt):self.engine.step()
  self.engine=ArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg)
  self.engine.step();self.assertEqual(len(self.entries()),1);self.assertFalse(self.ledger.unresolved_requests())
 def test_hard_loss_still_preempts_new_entry(self):
  self.prepare();self.candle(1.8,False);self.api.tick_bid+=30;self.api.tick_ask+=30
  self.assertEqual(self.engine.step(),'COMPLETE_RISK_EXIT');self.assertFalse(self.entries());self.assertFalse(self.api.positions)
 def test_cycle_settings_cannot_change_after_start(self):
  self.start();other=execution_config(.02,3.5,settings=default_settings()|{'baseLot':.02})
  with self.assertRaises(ArcSafetyError):ArcExecutionEngine(self.a,self.store,self.ledger,cfg=other)
 def test_deadline_preserves_live_fixed_ladder_and_blocks_new_cycle(self):
  session=Session.__new__(Session);session.clock=lambda:self.now;session.deadline=self.now-1
  session.calendar=NS(decision=lambda:dict(status='CLEAR',entries_allowed=True,reason='CLEAR'))
  session.write_failed=False;session.acknowledged=lambda:True
  from v51_guarded_engine import NewsGuardedArcExecutionEngine
  # Admission is clear to arm, then expires after L1 fills.
  session.deadline=self.now+100
  self.engine=NewsGuardedArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg,fixed_arming='PREARM_BOTH',diagnostic_sink=lambda r:None)
  self.engine.news_provider=lambda:session.decision(active_cycle=bool(self.engine.state.get('cycle_id')))
  self.start();self.api.fill_layer(1);self.engine.step();before=[o.ticket for o in self.api.orders]
  self.assertEqual(len(before),4);session.deadline=self.now-1
  self.engine.step();self.assertEqual([o.ticket for o in self.api.orders],before)
  self.assertEqual(session.decision()['reason'],'BATCH_ENTRY_DEADLINE')
  self.api.fill_layer(2);self.engine.step();self.assertEqual(len(self.api.positions),2)
  self.assertFalse(self.engine.state.get('news_entry_suspended'))
  session.calendar.decision=lambda:dict(status='BLACKOUT',entries_allowed=False,reason='HIGH_IMPACT_NEWS_WINDOW')
  self.engine.step();self.assertFalse(self.api.orders)
  self.assertTrue(self.engine.state['news_entry_suspended'])

class SettingsTests(unittest.TestCase):
 def test_baseline_digest_and_legacy_settings_stay_unchanged(self):
  self.assertEqual(verify_spec(),SPEC_SHA256);self.assertEqual(CONFIG.hard_basket_loss_usd,-120)
  c=execution_config(.1,12.34,settings=default_settings()|{'baseLot':.1,'tpMode':'CUSTOM','customTpUsd':12.34})
  self.assertEqual(verify_spec(cfg=c),SPEC_SHA256);self.assertEqual(c.hard_basket_loss_usd,-250)
  with self.assertRaises(ArcSafetyError):verify_spec(cfg=replace(c,base_lot=.11))
 def test_all_lots_and_tp_modes_are_strict(self):
  for i in range(1,11):self.assertEqual(validate_settings(default_settings()|{'baseLot':i/100})['baseLot'],i/100)
  for bad in [True,0,.011,.11,float('nan')]:
   with self.assertRaises(ValueError):validate_settings(default_settings()|{'baseLot':bad})
  for custom in [0,True,251,1.001,float('inf')]:
   with self.assertRaises(ValueError):validate_settings(default_settings()|{'tpMode':'CUSTOM','customTpUsd':custom})
 def test_current_atr_usd_and_fixed_modes_are_separate(self):
  bars=[Bar(time=i*60,open=100,high=101.05,low=98.95,close=100,spread_points=240) for i in range(15)]
  a=NS(cfg=CONFIG,recent_closed_bars=lambda count:bars)
  with patch('v51_execution_settings.time',return_value=900):
   for mode,target in [('ATR_1',2.1),('ATR_2',4.2),('FIXED_3_5',3.5),('CUSTOM',8.75)]:
    c=configure_adapter(a,default_settings()|{'tpMode':mode,'customTpUsd':8.75 if mode=='CUSTOM' else None})
    proof=execution_config_proof(c)
    if mode.startswith('ATR_'):
     self.assertIsNone(proof['tp_distance_price'])
     self.assertAlmostEqual(proof['target_usd'],target)
    else:
     self.assertEqual(c.basket_profit_target_usd,target)
     self.assertEqual(proof['target_usd'],target)
  with patch('v51_execution_settings.time',return_value=1020),self.assertRaises(ArcSafetyError):configure_adapter(a,default_settings()|{'tpMode':'ATR_1'})
if __name__=='__main__':unittest.main()
