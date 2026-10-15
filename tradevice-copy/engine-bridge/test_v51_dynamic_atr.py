"""Offline dynamic USD TP and projection-free adaptive admission regression."""
import sys,unittest,math
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace as NS
sys.path.insert(0,str(Path(__file__).parent/'tests'))
import test_goldtrap_arc_pending_execution as legacy
from goldtrap_arc.config import CONFIG,execution_config,execution_config_proof,basket_tp_usd,update_atr_target,dynamic_atr_tp,ArcSafetyError
from goldtrap_arc.models import Position,Side,Bar
from goldtrap_arc.rules import basket_target_price,basket_target_profit
from goldtrap_arc.adaptive_policy import risk_assessment
from goldtrap_arc.execution import ArcExecutionEngine
from demo_settings import default_settings,validate_settings
from v51_execution_settings import configure_adapter

def config(mode='ATR_1',atr=4.,lot=.01,candle=1000):
 mult=2 if mode=='ATR_2' else 1
 return execution_config(lot,atr*mult,settings=default_settings()|dict(baseLot=lot,tpMode=mode),atr=atr,candle_time=candle)

class Math(unittest.TestCase):
 def test_current_usd_not_price_distance_and_not_volume_scaled(self):
  for lot in (.01,.1):
   for mode,mult,loss in [('ATR_1',1,-250),('ATR_2',2,-350)]:
    c=config(mode,lot=lot)
    self.assertEqual(basket_tp_usd(c),4*mult);self.assertEqual(c.hard_basket_loss_usd,loss)
    update_atr_target(c,3.1,1060)
    for side in (Side.BUY,Side.SELL):
     p=[Position(1,side,lot,4100,0,'FIXTURE')]
     self.assertAlmostEqual(basket_target_profit(p,c),3.1*mult)
     self.assertAlmostEqual(abs(basket_target_price(p,c)-4100),3.1*mult/(lot*100))
 def test_updates_up_down_without_changing_immutable_config(self):
  c=config();before=execution_config_proof(c)
  for i,atr in enumerate((3.1,5.,2.10345)):
   update_atr_target(c,atr,1060+i*60);self.assertEqual(basket_tp_usd(c),atr)
  self.assertEqual(execution_config_proof(c),before)
  with self.assertRaises(ArcSafetyError):update_atr_target(c,4,1000)
  with self.assertRaises(ArcSafetyError):update_atr_target(c,7,1180)
 def test_projection_cannot_reduce_requested_lot(self):
  c=config()
  r=risk_assessment(-200,.19,4100,4100.24,4,.12,c)
  self.assertEqual(r['selected_lot'],.12);self.assertLess(r['selected_stress_pl'],-250)
  self.assertLess(risk_assessment(-100,.19,4100,4100.24,4,.12,CONFIG)['selected_lot'],.12)
 def test_previous_protocol_cannot_authorize_new_settings(self):
  with self.assertRaises(ValueError):validate_settings(default_settings()|dict(protocol='V51_ATR_PRICE_DISTANCE_20261015'))
 def test_closed_atr_not_current_forming_bar(self):
  bars=[Bar(i*60,100,102,98,100,240) for i in range(15)]
  a=NS(cfg=CONFIG,recent_closed_bars=lambda count:bars)
  with patch('v51_execution_settings.time',return_value=900):
   c=configure_adapter(a,default_settings()|dict(tpMode='ATR_2'))
  self.assertEqual(basket_tp_usd(c),8);self.assertEqual(c.hard_basket_loss_usd,-350)

class Engine(unittest.TestCase):
 def setUp(self):
  legacy.PendingExecutionTests.setUp(self)
  t=int(self.now)//60*60-60
  self.rows=[dict(time=t-(14-i)*60,open=100,high=102,low=98,close=100,spread=240) for i in range(15)]
  self.api.copy_rates_from_pos=lambda *args:self.rows
  self.cfg=config(candle=t);self.a.cfg=self.cfg
  original=self.api._entry_deal
  def entry(ticket,request):
   d=original(ticket,request);d.type=0 if ':B' in request['comment'] else 1;d.price=request['price'];return d
  self.api._entry_deal=entry
  self.engine=ArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg,fixed_arming='PREARM_BOTH')
 def change_atr(self,atr):
  self.now+=60
  for r in self.rows:r['time']+=60;r['high']=100+atr/2;r['low']=100-atr/2
 def fill(self):
  self.assertEqual(self.engine.step(),'TRAP_ARMED');self.api.fill_layer(1);self.assertEqual(self.engine.step(),'ACTIVE')
 def test_pending_tp_changes_keep_entry_prices_lots_and_tickets(self):
  self.engine.step();before={o.ticket:(o.price_open,o.price_stoplimit,o.volume_current) for o in self.api.orders}
  self.change_atr(3.1);self.engine.step()
  self.assertAlmostEqual(basket_tp_usd(self.cfg),3.1)
  self.assertEqual(before,{o.ticket:(o.price_open,o.price_stoplimit,o.volume_current) for o in self.api.orders})
  self.assertEqual(len(self.api.orders),10)
  self.assertTrue(any(r.get('event')=='ATR_PENDING_TP_INTENT' for r in self.ledger.rows))
 def test_active_target_and_surviving_pending_update_no_reanchor(self):
  self.fill();before={o.ticket:o.price_open for o in self.api.orders}
  self.change_atr(3.1);self.engine.step()
  self.assertEqual(before,{o.ticket:o.price_open for o in self.api.orders})
  self.assertAlmostEqual(self.engine.state['tp_generation_profit_target'],3.1)
  self.assertEqual(len(self.api.orders),4)
 def test_stale_atr_cannot_arm_a_new_trap(self):
  self.now+=180
  self.assertEqual(self.engine.step(),'WAITING_ATR');self.assertFalse(self.api.sent)
 def test_stale_atr_retains_last_target_and_cannot_admit_entry(self):
  self.fill();self.now+=180
  self.assertFalse(self.engine.refresh_atr_tp());self.assertEqual(basket_tp_usd(self.cfg),4)
  self.assertTrue(self.engine.state['atr_tp_unavailable'])
 def test_no_early_fixed_price_distance_at_point_one_lot(self):
  # A target of $4 at 0.1 lot means 0.4 price movement, not 4.0.
  c=config(lot=.1);self.assertAlmostEqual(basket_target_price([Position(1,Side.BUY,.1,4100,0,'TEST')],c),4100.4)
 def test_manual_exit_cannot_be_reported_as_atr_tp(self):
  self.fill();p=self.api.positions[0]
  self.api.close_position_history(p,profit=8.96,reason=0);self.api.deals[-1].price=p.tp
  self.assertEqual(self.engine.step(),'COMPLETE_BROKER_CLOSED')
  self.assertTrue(self.engine.state['broker_flat_confirmed']);self.assertTrue(self.engine.state['block_batch_after_cleanup'])
 def test_actual_tp_price_proof_accepts_broker_cent_rounding(self):
  self.fill();p=self.api.positions[0]
  self.api.close_position_history(p,profit=3.99,reason=5);self.api.deals[-1].price=p.tp
  self.assertEqual(self.engine.step(),'COMPLETE_TARGET_HISTORY');self.assertFalse(self.api.orders)
 def test_lower_current_atr_exits_when_net_already_above_new_target(self):
  self.fill();p=self.api.positions[0]
  self.api.tick_bid=p.price_open+3.2;self.api.tick_ask=self.api.tick_bid+.24
  self.change_atr(3.1)
  self.assertEqual(self.engine.step(),'COMPLETE_TARGET')
  self.assertFalse(self.api.positions or self.api.orders)
 def test_research_projection_and_extra_reserve_are_not_consulted(self):
  from v51_batch_research import ResearchBatchAdapter
  from v51_batch_core import BatchAdapter
  a=ResearchBatchAdapter.__new__(ResearchBatchAdapter);a.cfg=self.cfg;a.store=NS(load=lambda:{'adaptive_intent':{'bars':[b.__dict__ for b in self.a.recent_closed_bars(15)],'atr':4.}})
  a.ledger=self.ledger;a.recent_closed_bars=self.a.recent_closed_bars
  a.executable_pl=lambda snap:(_ for _ in ()).throw(AssertionError('projection queried'))
  with patch.object(BatchAdapter,'validate_adaptive',return_value='validated broker snapshot'):
   self.assertEqual(a.validate_adaptive('fixture',Side.BUY,6,.12),'validated broker snapshot')
 def test_partial_history_cannot_prove_target(self):
  self.fill();p=self.api.positions[0]
  self.api.close_position_history(p,profit=4,reason=5);self.api.deals[-1].price=p.tp
  life=self.a.cycle_lifecycle(self.engine.state['cycle_id']);self.api.deals[-1].volume=.005
  self.assertFalse(self.engine._atr_history_target_reached(life))
 def test_late_fill_after_proven_target_is_cleaned_and_flat(self):
  self.fill();self.api.fill_layer(2);self.engine.step();target=self.engine.state['tp_generation_target']
  for d in self.api.deals:d.time_msc=int(self.now*1000)-100
  for p in list(self.api.positions):
   self.api.close_position_history(p,profit=2,reason=5);self.api.deals[-1].price=target;self.api.deals[-1].time_msc=int(self.now*1000)
  self.now+=.1;self.api.fill_layer(3);self.api.deals[-1].time_msc=int(self.now*1000)
  self.assertEqual(self.engine.step(),'COMPLETE_TERMINAL_CLEANUP');self.assertFalse(self.api.positions or self.api.orders)
 def test_one_atr_hard_loss_still_exits_at_minus_300(self):
  self.fill()
  with patch.object(self.a,'executable_pl',return_value=-300):
   self.assertEqual(self.engine.step(),'COMPLETE_RISK_EXIT')
  self.assertFalse(self.api.positions or self.api.orders)
 def test_two_atr_does_not_exit_at_minus_300(self):
  state=self.store.load();state.pop('execution_config');self.store.save(state)
  self.cfg=config('ATR_2',candle=self.rows[-1]['time']);self.a.cfg=self.cfg
  self.engine=ArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg,fixed_arming='PREARM_BOTH');self.fill()
  with patch.object(self.a,'executable_pl',return_value=-300):
   self.assertEqual(self.engine.step(),'ACTIVE')
  self.assertFalse(self.engine.state.get('risk_exit_committed'))
 def test_durable_target_restored_on_same_config_restart(self):
  self.fill();self.change_atr(3.1);self.engine.step()
  other=ArcExecutionEngine(self.a,self.store,self.ledger,cfg=self.cfg,fixed_arming='PREARM_BOTH')
  self.assertAlmostEqual(other.state['atr_tp_current']['target_usd'],3.1)
if __name__=='__main__':unittest.main()
