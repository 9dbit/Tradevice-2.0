"""Synthetic MT5 only: price-distance TP must not become a fixed USD exit."""
import unittest,sys
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace as NS
sys.path.insert(0,str(Path(__file__).parent/'tests'))
import test_goldtrap_arc_pending_execution as legacy
from goldtrap_arc.config import execution_config,execution_config_proof,atr_tp_distance,CONFIG
from goldtrap_arc.models import Position,Side,Bar
from goldtrap_arc.rules import basket_target_price,basket_target_profit,basket_average
from goldtrap_arc.pending_ladder import quantized_target,initial_plan
from goldtrap_arc.execution import ArcExecutionEngine
from demo_settings import default_settings,validate_settings
from v51_execution_settings import configure_adapter

def cfg(lot=.1,points=4200):
 return configure_adapter(NS(cfg=CONFIG),default_settings()|dict(baseLot=lot,tpMode='POINTS',tpPoints=points))

class PointsMath(unittest.TestCase):
 def test_distance_is_independent_of_volume_and_direction(self):
  for lot in (.01,.02,.1):
   for side in (Side.BUY,Side.SELL):
    for points in (1,1000,4200,100000):
     c=cfg(lot,points);p=[Position(1,side,lot,4100,0,'TEST')]
     self.assertAlmostEqual(abs(basket_target_price(p,c)-4100),points*.001)
     self.assertAlmostEqual(basket_target_profit(p,c),points*.1*lot)
     self.assertEqual(execution_config_proof(c)['settings']['tpPoints'],points)
     self.assertIsNone(execution_config_proof(c)['target_usd'])
 def test_weighted_entry_moves_but_distance_stays_fixed(self):
  for side in (Side.BUY,Side.SELL):
   c=cfg();p=[Position(1,side,.1,4100,0,'TEST'),Position(2,side,.17,4099,0,'TEST')]
   self.assertAlmostEqual(abs(basket_target_price(p,c)-basket_average(p)),4.2)
   self.assertAlmostEqual(basket_target_profit(p,c),113.4)
 def test_settings_validation_and_legacy_unchanged(self):
  self.assertEqual(validate_settings(default_settings()),default_settings())
  good=default_settings()|dict(tpMode='POINTS',tpPoints=4200)
  for invalid in (True,False,0,-1,1.5,4200.0,'4200',None,float('nan'),float('inf'),100001):
   with self.subTest(value=invalid),self.assertRaises(ValueError):validate_settings(good|{'tpPoints':invalid})
  for invalid in (good|{'customTpUsd':4.2},default_settings()|{'tpPoints':4200}):
   with self.assertRaises(ValueError):validate_settings(invalid)
 def test_forged_distance_rejected(self):
  from goldtrap_arc.config import ArcSafetyError
  with self.assertRaises(ArcSafetyError):execution_config(.1,None,settings=default_settings()|dict(baseLot=.1,tpMode='POINTS',tpPoints=4200),atr_distance=.42)
 def test_no_atr_fetch_and_no_candle_dependency(self):
  a=NS(cfg=CONFIG,recent_closed_bars=lambda n:self.fail('Points mode must not read ATR'))
  self.assertEqual(atr_tp_distance(configure_adapter(a,default_settings()|dict(tpMode='POINTS',tpPoints=4200))),4.2)

class PointsExecution(unittest.TestCase):
 def setUp(self):
  legacy.PendingExecutionTests.setUp(self)
  original=self.api._entry_deal
  def entry(ticket,request):
   deal=original(ticket,request);deal.type=0 if ':B' in request['comment'] else 1;deal.price=request['price'];return deal
  self.api._entry_deal=entry
  self.cfg=cfg();self.a.cfg=self.cfg
  self.engine=ArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg,fixed_arming='PREARM_BOTH')
 def start_fill(self,side=Side.BUY):
  self.assertEqual(self.engine.step(),'TRAP_ARMED')
  p=self.api.fill_layer(1,side);self.assertEqual(self.engine.step(),'ACTIVE');return p
 def test_all_ten_prearmed_tps_use_the_new_distance(self):
  self.assertEqual(self.engine.step(),'TRAP_ARMED')
  # Rebuild from persisted plan: current tick may differ after arming.
  for side in (Side.BUY,Side.SELL):
   rows=[x for x in self.engine.state['initial_fixed_plan'] if x['side']==side.value]
   models=[]
   for row in rows:
    models.append(Position(row['layer'],side,row['lot'],row['price'],0,'PLAN'))
    self.assertAlmostEqual(row['tp'],quantized_target(models,self.cfg))
 def test_tp_resync_after_actual_slipped_fill_keeps_distance(self):
  self.start_fill();self.api.fill_layer(2,slippage=.015);self.engine.step()
  models=self.a.models(self.a.snapshot().positions);target=quantized_target(models,self.cfg)
  self.assertTrue(all(abs(p.tp-target)<1e-9 for p in self.api.positions))
  self.assertGreaterEqual(target-basket_average(models),4.2-1e-9)
  self.assertLess(target-basket_average(models),4.201)
  self.assertAlmostEqual(self.engine.state['tp_generation_profit_target'],113.4)
 def test_profit_4_2_does_not_close_point_4200_target_at_point_420(self):
  p=self.start_fill();self.api.tick_bid=p.price_open+.42;self.api.tick_ask=self.api.tick_bid+.24
  sent=len(self.api.sent)
  self.assertFalse(self.engine.target_coordinator('fixture'))
  self.assertEqual(len(self.api.sent),sent);self.assertEqual(len(self.api.positions),1)
  self.api.tick_bid=p.tp;self.api.tick_ask=p.tp+.24
  self.assertTrue(self.engine.target_coordinator('fixture'))
  self.assertFalse(self.api.positions or self.api.orders)
 def test_sell_uses_ask_and_correct_distance(self):
  p=self.start_fill(Side.SELL);self.api.tick_ask=p.price_open-.42;self.api.tick_bid=self.api.tick_ask-.24
  self.assertFalse(self.engine.target_coordinator('fixture'))
  self.api.tick_ask=p.tp;self.api.tick_bid=p.tp-.24
  self.assertTrue(self.engine.target_coordinator('fixture'))
 def test_broker_tp_history_proves_price_and_flat_without_dollar_tolerance(self):
  p=self.start_fill();target=p.tp
  self.api.close_position_history(p,profit=41.99,reason=5);self.api.deals[-1].price=target
  self.assertEqual(self.engine.step(),'COMPLETE_TARGET_HISTORY')
  self.assertTrue(self.engine.state['broker_flat_confirmed']);self.assertFalse(self.api.orders)
 def test_manual_close_cannot_masquerade_as_points_tp(self):
  p=self.start_fill();target=p.tp
  self.api.close_position_history(p,profit=42,reason=0);self.api.deals[-1].price=target
  self.assertEqual(self.engine.step(),'COMPLETE_BROKER_CLOSED')
  self.assertTrue(self.engine.state['block_batch_after_cleanup'])
 def test_old_dollar_tp_price_is_not_points_history_completion(self):
  p=self.start_fill();price=p.price_open+.42
  self.api.close_position_history(p,profit=4.2,reason=5);self.api.deals[-1].price=price
  self.assertEqual(self.engine.step(),'COMPLETE_BROKER_CLOSED')
 def test_prearmed_fill_and_tp_between_polls_is_reconciled_by_price(self):
  self.assertEqual(self.engine.step(),'TRAP_ARMED')
  p=self.api.fill_layer(1);target=p.tp
  self.api.close_position_history(p,profit=41.99,reason=5);self.api.deals[-1].price=target
  self.assertEqual(self.engine.step(),'COMPLETE_TARGET_HISTORY')
  self.assertFalse(self.api.positions or self.api.orders)
 def test_late_recovery_fill_is_cleaned_after_proven_points_tp(self):
  self.start_fill();self.api.fill_layer(2);self.engine.step()
  target=self.engine.state['tp_generation_target']
  for d in self.api.deals:d.time_msc=int(self.now*1000)-100
  for p in list(self.api.positions):
   self.api.close_position_history(p,profit=56.7,reason=5)
   self.api.deals[-1].price=target;self.api.deals[-1].time_msc=int(self.now*1000)
  self.now+=.1;p=self.api.fill_layer(3);self.api.deals[-1].time_msc=int(self.now*1000)
  self.assertEqual(self.engine.step(),'COMPLETE_TERMINAL_CLEANUP')
  self.assertFalse(self.api.positions or self.api.orders)
  self.assertTrue(self.engine.state['broker_flat_confirmed'])
 def test_incomplete_history_volume_cannot_prove_points_tp(self):
  p=self.start_fill();target=p.tp
  self.api.close_position_history(p,profit=42,reason=5);self.api.deals[-1].price=target
  life=self.a.cycle_lifecycle(self.engine.state['cycle_id'])
  self.api.deals[-1].volume=.05
  self.assertFalse(self.engine._atr_history_target_reached(life))
 def test_restart_preserves_frozen_target(self):
  p=self.start_fill();target=p.tp
  self.engine=ArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg)
  self.engine.step();self.assertEqual(self.api.positions[0].tp,target)
 def test_diagnostics_separate_points_price_and_profit(self):
  from v51_engine_diagnostics import make_report
  self.start_fill();report=make_report(self.engine,int(self.now*1000))
  self.assertEqual(report['tp_basis'],'POINTS_PRICE_DISTANCE')
  self.assertAlmostEqual(report['tp_distance_points'],4200)
  self.assertAlmostEqual(report['tp_distance_price'],4.2)
  self.assertAlmostEqual(report['target_usd'],42)
if __name__=='__main__':unittest.main()
