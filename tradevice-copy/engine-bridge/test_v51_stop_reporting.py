import unittest
from v51_batch_telemetry import report,stop_blockers
class Reporting(unittest.TestCase):
 def test_reject_is_bounded_code_without_raw_private_error(self):
  self.assertEqual(stop_blockers({'status':'SAFETY_STOP','error':"ArcDefinitiveReject('MT5 order_send rejected retcode=10013')"}),['BROKER_REJECT_10013'])
  self.assertEqual(stop_blockers({'status':'SAFETY_STOP','error':'private detail'}),['BATCH_SAFETY_STOP'])
 def test_unfinished_zero_is_not_final_pnl(self):
  slot=dict(number=1,cycle_id='abcdef12',result=dict(outcome='SAFETY_STOP',layers=1,realized_pl_usd=0,broker_flat_confirmed=False))
  self.assertIsNone(report('fixture','SAFETY_STOP',[slot])['cycles'][0]['net_usd'])
  slot['result'].update(outcome='COMPLETE_BROKER_TP_RECONCILED',broker_flat_confirmed=True,realized_pl_usd=2.1)
  self.assertEqual(report('fixture','STOPPED',[slot])['cycles'][0]['net_usd'],2.1)
