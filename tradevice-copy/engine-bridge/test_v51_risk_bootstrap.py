"""Mocked real-store startup checks for the new V5.1 research risk supervisor."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock

from goldtrap_arc.config import CONFIG,ArcSafetyError
from goldtrap_arc.persistence import ArcLedger, ArcStateStore
from v51_loss_capped_engine import LossCappedArcEngine


class Bootstrap(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.path=Path(self.t.name)
        self.store=ArcStateStore(self.path)
        self.ledger=ArcLedger(self.path)

    def adapter(self,equity=500):
        a=Mock()
        a.guard_identity.return_value=(NS(currency="USD",equity=equity),NS(connected=True),NS(name="XAUUSDm"))
        return a

    def test_initial_cap_persists_before_entry_and_freezes_at_restart(self):
        e=LossCappedArcEngine(self.adapter(500),self.store,self.ledger,cfg=CONFIG,fixed_arming="PREARM_BOTH")
        self.assertEqual(e.risk_threshold,-15.0)
        self.assertEqual(self.store.load()["researchRiskCeiling"]["maxCycleLossUsd"],15.0)
        event_count=len(self.ledger.rows)
        again=LossCappedArcEngine(self.adapter(15000),self.store,ArcLedger(self.path),cfg=CONFIG,fixed_arming="PREARM_BOTH")
        self.assertEqual(again.risk_threshold,-15.0)
        self.assertEqual(len(again.ledger.rows),event_count)

    def test_tampered_risk_limit_fails_before_restart(self):
        first=LossCappedArcEngine(self.adapter(),self.store,self.ledger,cfg=CONFIG,fixed_arming="PREARM_BOTH")
        state=self.store.load()
        state["researchRiskCeiling"]["maxCycleLossUsd"]=40
        self.store.save(state)
        with self.assertRaisesRegex(ArcSafetyError,"EXPOSURE_PERSISTED_RISK_PROOF_INVALID"):
            LossCappedArcEngine(self.adapter(),self.store,ArcLedger(self.path),cfg=CONFIG,fixed_arming="PREARM_BOTH")


if __name__=="__main__":
    unittest.main()
