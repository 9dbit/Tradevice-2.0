"""Synthetic MT5 activation races; never connects to a terminal."""
import unittest
from types import SimpleNamespace as NS
from dataclasses import replace
from test_v51_dynamic_atr import Engine
from goldtrap_arc.models import Side
from goldtrap_arc.config import ArcSafetyError
from goldtrap_arc.mt5_adapter import ArcPendingTransitionWait,ArcDefinitiveReject,ArcUncertainRequest

class PendingTransition(unittest.TestCase):
 setUp=Engine.setUp
 def armed(self,side=Side.SELL):
  self.engine.step()
  return next(o for o in self.a.snapshot().orders if o.side==side and o.layer==2)
 def test_stale_snapshot_uses_current_limit_without_reanchor(self):
  for side in (Side.BUY,Side.SELL):
   before=self.armed(side);self.api.activate(side)
   self.a.modify_pending(before,before.entry_price,before.tp+.1)
   request=self.api.sent[-1]
   self.assertEqual((request['price'],request['stoplimit']),(before.entry_price,0))
   self.assertEqual(len(self.api.orders),10)
 def test_activation_during_order_check_defers_before_dispatch(self):
  before=self.armed();count=len(self.api.sent)
  self.api.order_check=lambda r:(self.api.activate(Side.SELL) or NS(retcode=0))
  with self.assertRaises(ArcPendingTransitionWait):self.a.modify_pending(before,before.entry_price,before.tp+.1)
  self.assertEqual(len(self.api.sent),count);self.assertFalse(self.ledger.unresolved_requests())
 def test_rejected_activation_race_resolves_once_without_resend(self):
  before=self.armed();count=len(self.api.sent)
  def send(r):
   self.api.sent.append(dict(r));self.api.activate(Side.SELL)
   return NS(retcode=10013,order=0,deal=0,comment='Invalid request')
  self.api.order_send=send
  with self.assertRaises(ArcPendingTransitionWait):self.a.modify_pending(before,before.entry_price,before.tp+.1)
  self.assertEqual(len(self.api.sent),count+1);self.assertFalse(self.ledger.unresolved_requests())
  self.assertEqual(len(self.api.orders),10)
 def test_unrelated_invalid_request_stays_fatal(self):
  before=self.armed();self.api.order_send=lambda r:NS(retcode=10013,order=0,deal=0)
  with self.assertRaises(ArcDefinitiveReject):self.a.modify_pending(before,before.entry_price,before.tp+.1)
 def test_unknown_response_never_becomes_safe_transition(self):
  before=self.armed();self.api.order_send=lambda r:None
  with self.assertRaises(ArcUncertainRequest):self.a.modify_pending(before,before.entry_price,before.tp+.1)
  self.assertTrue(self.ledger.unresolved_requests())
 def test_wrong_volume_or_entry_never_silently_repaired(self):
  before=self.armed();raw=next(o for o in self.api.orders if o.ticket==before.ticket)
  raw.volume_current=.03
  with self.assertRaises(ArcSafetyError):self.a.modify_pending(before,before.entry_price,before.tp+.1)
  raw.volume_current=before.volume;raw.price_stoplimit+=.1
  with self.assertRaises(ArcSafetyError):self.a.modify_pending(before,before.entry_price,before.tp+.1)
 def test_filled_pending_defers_without_replacement(self):
  before=self.armed();self.api.activate(Side.SELL);self.api.fill_layer(2,Side.SELL);count=len(self.api.sent)
  with self.assertRaises(ArcPendingTransitionWait):self.a.modify_pending(before,before.entry_price,before.tp+.1)
  self.assertEqual(len(self.api.sent),count)
 def test_engine_keeps_owned_ladder_on_activation_during_sync(self):
  self.engine.step();self.api.fill_layer(1,Side.SELL,slippage=-.108)
  # Recreate a lagging stop-limit read after L1 has filled; activation occurs
  # only when the first pending TP passes order_check, as in the incident.
  for raw in self.api.orders:
   if ':S' in raw.comment:
    raw.type=7;raw.price_stoplimit=raw.price_open;raw.price_open=self.engine.state['initial_fixed_plan'][5]['price']
  original=self.api.order_check
  def check(r):
   if r['action']==7:self.api.activate(Side.SELL)
   return original(r)
  self.api.order_check=check
  self.assertEqual(self.engine.step(),'ACTIVE')
  self.assertEqual(len(self.api.orders),4);self.assertEqual(len(self.api.positions),1)
  self.assertFalse(self.engine.state.get('safety_paused'))
  self.assertEqual(self.engine.step(),'ACTIVE');self.assertEqual(len(self.api.orders),4)
if __name__=='__main__':unittest.main()
