"""Entry dispatch integration tests against a locally patched, never-armed clone.

Set PYTHONPATH=staged_shadow;isolated_clone when running. No MetaTrader5 calls.
"""
import unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch

from goldtrap_arc.config import ArcSafetyError
from v51_batch_core import BatchAdapter
from v51_batch_research import ResearchBatchAdapter
from v51_dashboard_runtime import Runtime
from v51_exposure_policy import POLICY


class GuardedEntryDispatch(unittest.TestCase):
    def adapter(self, booked):
        obj = ResearchBatchAdapter.__new__(ResearchBatchAdapter)
        obj.guard_book = Mock(return_value=NS(
            positions=tuple(NS(volume=v) for v in booked[0]),
            orders=tuple(NS(volume=v) for v in booked[1]),
        ))
        return obj

    def test_pending_ladder_permits_exact_040_limit(self):
        adapter=self.adapter(([.19],[.19]))
        with patch.object(BatchAdapter, "_write",return_value="SYNTHETIC_RECEIPT") as write:
            result=adapter._write({"volume":.02},operation="FIXED_PENDING",cycle_id="test")
            self.assertEqual(result,"SYNTHETIC_RECEIPT")
            write.assert_called_once()
        adapter.guard_book.assert_called_once_with("test",fresh=True)

    def test_pending_ladder_refuses_oversized_order_before_parent_write(self):
        adapter=self.adapter(([.19],[.19]))
        with patch.object(BatchAdapter,"_write",return_value="SHOULD_NEVER_SEND") as write:
            with self.assertRaisesRegex(ArcSafetyError,"EXPOSURE_DISPATCH_CAP_EXCEEDED"):
                adapter._write({"volume":.03},operation="FIXED_PENDING",cycle_id="test")
            write.assert_not_called()

    def test_adaptive_market_l6_l7_guard(self):
        with patch.object(BatchAdapter,"_write",return_value="SYNTHETIC") as write:
            adapter=self.adapter(([.19],[]))
            self.assertEqual(adapter._write({"volume":.13},operation="ADAPTIVE_MARKET",cycle_id="test"),"SYNTHETIC")
            adapter=self.adapter(([.32],[]))
            with self.assertRaisesRegex(ArcSafetyError,"EXPOSURE_DISPATCH_CAP_EXCEEDED"):
                adapter._write({"volume":.22},operation="ADAPTIVE_MARKET",cycle_id="test")
            self.assertEqual(write.call_count,1)

    def test_protection_actions_remain_available_above_entry_limit(self):
        adapter=self.adapter(([1.87],[1.87]))
        with patch.object(BatchAdapter,"_write",return_value="CLOSE_OK") as write:
            for operation in ("CANCEL","CLOSE","TP_SYNC","PENDING_MODIFY"):
                self.assertEqual(adapter._write({"volume":1.87},operation=operation,cycle_id="test"),"CLOSE_OK")
            self.assertEqual(write.call_count,4)
        adapter.guard_book.assert_not_called()

    def test_forged_or_missing_broker_volume_is_rejected(self):
        adapter=self.adapter(([],[float("nan")]))
        with patch.object(BatchAdapter,"_write",return_value="NO") as write:
            with self.assertRaisesRegex(ArcSafetyError,"EXPOSURE_INVALID_BROKER_VOLUME"):
                adapter._write({"volume":.01},operation="FIXED_PENDING",cycle_id="test")
            write.assert_not_called()


if __name__=="__main__":
    unittest.main()
