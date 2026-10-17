"""Synthetic no-broker tests for the V5.1 conservative risk cage."""
import math
import unittest
from dataclasses import replace
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch

from goldtrap_arc.config import CONFIG
from v51_exposure_policy import (
    POLICY, MAX_BOOKED_LOTS, ResearchRiskBlocked,
    ladder_lots, check_arming_plan, check_dispatch, booked_exposure,
    risk_ceiling, ensure_risk_proof,
)
from v51_loss_capped_engine import LossCappedArcEngine
from v51_guarded_engine import NewsGuardedArcExecutionEngine


class Exposure(unittest.TestCase):
    def test_fixed_ladder_matches_journal(self):
        cfg=replace(CONFIG,base_lot=.10)
        self.assertEqual(ladder_lots(cfg),[.1,.17,.29,.49,.82])
        with self.assertRaisesRegex(ResearchRiskBlocked,"EXPOSURE_PLAN_CAP_EXCEEDED"):
            check_arming_plan(cfg)

    def test_only_smallest_base_lot_can_prearm_both_five_levels(self):
        cfg=replace(CONFIG,base_lot=.01)
        self.assertEqual(ladder_lots(cfg),[.01,.02,.03,.05,.08])
        allowed=check_arming_plan(cfg)
        self.assertAlmostEqual(allowed["grossBookedLots"],.38)
        for lot in (.02,.03,.04,.05,.06,.07,.08,.09,.1):
            with self.assertRaisesRegex(ResearchRiskBlocked,"EXPOSURE_PLAN_CAP_EXCEEDED"):
                check_arming_plan(replace(CONFIG,base_lot=lot))

    def test_gross_book_includes_opposite_orders_and_positions(self):
        positions=[NS(volume=.10)]
        orders=[NS(volume=.10),NS(volume=.18)]
        self.assertAlmostEqual(booked_exposure(positions,orders),.38)
        self.assertAlmostEqual(check_dispatch(positions,orders,.02)["bookedAfterLots"],.40)
        with self.assertRaisesRegex(ResearchRiskBlocked,"EXPOSURE_DISPATCH_CAP_EXCEEDED"):
            check_dispatch(positions,orders,.03)

    def test_no_netting_unknown_volume_or_negative_exposure(self):
        for p,o,proposed in [(None,[],.01),([],None,.01),
                              ([NS(volume=float("nan"))],[],.01),
                              ([NS(volume=-.1)],[],.01),
                              ([],[],0),([],[],-.01),([],[],True)]:
            with self.subTest(p=p,o=o,proposed=proposed),self.assertRaises(ResearchRiskBlocked):
                check_dispatch(p,o,proposed)

    def test_risk_budget_is_frozen_and_equity_scaled(self):
        self.assertEqual(risk_ceiling(1000)["maxCycleLossUsd"],30.0)
        self.assertEqual(risk_ceiling(500)["maxCycleLossUsd"],15.0)
        self.assertEqual(risk_ceiling(19766.35)["maxCycleLossUsd"],30.0)
        self.assertEqual(ensure_risk_proof(risk_ceiling(1000))["policy"],POLICY)
        with self.assertRaisesRegex(ResearchRiskBlocked,"EXPOSURE_RISK_PROOF_CHANGED"):
            ensure_risk_proof(risk_ceiling(1000)|{"maxCycleLossUsd":31})
        with self.assertRaises(ResearchRiskBlocked):
            risk_ceiling(float("nan"))


class LossSupervisor(unittest.TestCase):
    def build(self, pl=-30.01, exact=-30.01):
        e=LossCappedArcEngine.__new__(LossCappedArcEngine)
        e.state={"cycle_id":"18c3ac11","state":"ACTIVE",
                 "researchRiskCeiling":risk_ceiling(1000)}
        e.risk_threshold=-30.0
        e.adapter=Mock()
        e.adapter.snapshot.return_value=NS(positions=(NS(ticket=44,volume=.19),),orders=(),tick=object())
        e.adapter.realized_pl.return_value=-30.5
        e.owned=Mock(return_value=([NS(ticket=44)],[]))
        e.total_pl=Mock(return_value=pl)
        e.exact_total_pl=Mock(return_value=exact)
        e.save=Mock()
        e.ledger=Mock()
        e._reduce_until_flat=Mock()
        e.mark_complete=Mock(side_effect=lambda status,**kw:e.state.update(state=status))
        return e

    def test_exact_recheck_can_veto_risk_exit(self):
        e=self.build(pl=-30.1,exact=-29.9)
        self.assertFalse(e.risk_exit())
        e._reduce_until_flat.assert_not_called()
        e.save.assert_not_called()

    def test_risk_exit_commits_then_reduces_and_blocks_next_cycle(self):
        e=self.build(pl=-31,exact=-30.5)
        self.assertTrue(e.risk_exit())
        self.assertTrue(e.state["risk_exit_committed"])
        self.assertTrue(e.state["block_next_cycle"])
        self.assertEqual(e.state["state"],"COMPLETE_RISK_EXIT")
        self.assertEqual(e.ledger.append.call_args_list[0].args[0],"RISK_EXIT_COMMITTED")
        self.assertAlmostEqual(e.ledger.append.call_args_list[0].kwargs["threshold"],-30)
        e._reduce_until_flat.assert_called_once_with("RISK_EXIT")

    def test_committed_exit_is_idempotent_on_reentry(self):
        e=self.build()
        e.state["risk_exit_committed"]=True
        self.assertTrue(e.risk_exit())
        self.assertEqual(e.ledger.append.call_count,1)
        self.assertEqual(e.ledger.append.call_args.args[0],"COMPLETE_RISK_EXIT")
        e._reduce_until_flat.assert_called_once()

    def test_step_intercepts_loss_before_normal_engine_path(self):
        e=self.build(pl=-31,exact=-31)
        e.adapter.quote_metrics.return_value={"fresh":True}
        with patch("v51_loss_capped_engine.emergency_requested",return_value=False), \
             patch.object(NewsGuardedArcExecutionEngine,"step",return_value="NORMAL_STEP") as delegate:
            self.assertEqual(e.step(),"COMPLETE_RISK_EXIT")
            delegate.assert_not_called()
            e._reduce_until_flat.assert_called_once()

    def test_step_delegates_when_price_data_stale(self):
        e=self.build(pl=-31,exact=-31)
        e.adapter.quote_metrics.return_value={"fresh":False}
        with patch("v51_loss_capped_engine.emergency_requested",return_value=False), \
             patch.object(NewsGuardedArcExecutionEngine,"step",return_value="WAIT_QUOTE_RECOVERY") as delegate:
            self.assertEqual(e.step(),"WAIT_QUOTE_RECOVERY")
            delegate.assert_called_once()
            e._reduce_until_flat.assert_not_called()


if __name__=="__main__":
    unittest.main()
