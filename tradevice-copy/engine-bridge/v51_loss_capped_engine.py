"""Loss-limited V5.1 engine overlay for the isolated research clone.

Existing core hard loss is retained as a fallback; this overlay uses the
stricter frozen loss budget. Cancel/close/reconciliation are never subject to
the exposure-entry cap. A broker gap can exceed this monitored threshold.
"""
import math
from pathlib import Path
from time import time

from goldtrap_arc.config import ArcSafetyError
from goldtrap_arc.execution import ArcBrokerSettlementWait
from goldtrap_arc.mt5_adapter import ArcConnectionWait
from v51_guarded_engine import NewsGuardedArcExecutionEngine
from emergency_state import requested as emergency_requested
from v51_exposure_policy import ensure_risk_proof, risk_ceiling


class LossCappedArcEngine(NewsGuardedArcExecutionEngine):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        existing = self.state.get("researchRiskCeiling")
        if existing is None:
            if self.state.get("cycle_id"):
                raise ArcSafetyError("EXPOSURE_EXISTING_CYCLE_HAS_NO_BOUND_RISK")
            account, _, _ = self.adapter.guard_identity()
            if getattr(account, "currency", None) != "USD":
                raise ArcSafetyError("EXPOSURE_EQUITY_CURRENCY_MISMATCH")
            try:
                proof = risk_ceiling(float(account.equity))
            except (ValueError, TypeError, AttributeError) as exc:
                raise ArcSafetyError("EXPOSURE_EQUITY_NOT_VERIFIED") from exc
            self.state["researchRiskCeiling"] = proof
            self.save()
            self.ledger.append("RESEARCH_RISK_CEILING_BOUND", **proof)
        else:
            try:
                proof = ensure_risk_proof(existing)
            except ValueError as exc:
                raise ArcSafetyError("EXPOSURE_PERSISTED_RISK_PROOF_INVALID") from exc
        self.risk_threshold = max(float(self.cfg.hard_basket_loss_usd),
                                  -float(proof["maxCycleLossUsd"]))
        if not math.isfinite(self.risk_threshold) or self.risk_threshold >= 0:
            raise ArcSafetyError("EXPOSURE_INVALID_LOSS_THRESHOLD")

    def step(self):
        # Emergency close has priority and will hand off under the existing lock.
        if emergency_requested(Path(__file__).resolve().parent):
            return super().step()
        if (self.state.get("cycle_id")
                and not str(self.state.get("state", "")).startswith("COMPLETE")
                and not self.state.get("risk_exit_committed")
                and not self.state.get("terminal_exit_committed")
                and not self.state.get("target_exit_committed")
                and not self.state.get("safety_paused")):
            try:
                snap = self.adapter.snapshot(require_fresh_tick=False)
                if self.adapter.quote_metrics(snap.tick).get("fresh") is True:
                    positions, _ = self.owned(snap, reduction=True, allow_settlement_wait=True)
                    if positions and self.total_pl(snap) <= self.risk_threshold:
                        if self.risk_exit():
                            return self.state["state"]
            except (ArcConnectionWait, ArcBrokerSettlementWait):
                # Core state machine owns connection/settlement waiting, and
                # disallows entry while market data cannot be verified.
                pass
            except ArcSafetyError as exc:
                self.pause_safety(exc)
                raise
        return super().step()

    def risk_exit(self, trigger_pl=None):
        # Retain original idempotent lifecycle and journal format, but replace
        # the trigger with the stricter signed, frozen per-cycle cap.
        if not self.state.get("risk_exit_committed"):
            snap = self.adapter.snapshot()
            positions, _ = self.owned(snap)
            pl = self.total_pl(snap)
            if pl > self.risk_threshold:
                return False
            pl = self.exact_total_pl(snap)
            if pl > self.risk_threshold:
                return False
            self.state.update(
                state="RISK_EXIT",
                risk_exit_committed=True,
                risk_exit_commit_pl=pl,
                risk_exit_committed_at=time(),
                block_next_cycle=True,
            )
            self.save()
            self.ledger.append(
                "RISK_EXIT_COMMITTED",
                cycle_id=self.state["cycle_id"],
                executable_cycle_pl=pl,
                threshold=self.risk_threshold,
                risk_policy=self.state["researchRiskCeiling"]["policy"],
                position_tickets=[p.ticket for p in positions],
            )
        self._reduce_until_flat("RISK_EXIT")
        realized = self.adapter.realized_pl(self.state["cycle_id"])
        self.mark_complete("COMPLETE_RISK_EXIT", cached_realized_pl=realized)
        self.ledger.append(
            "COMPLETE_RISK_EXIT", cycle_id=self.state["cycle_id"],
            positions=0, orders=0, actual_realized_pl=realized,
        )
        return True
