"""Conservative V5.1 research exposure and cycle-loss limits.

Pure admission helpers. Counts broker pending orders as full potential exposure,
does not net BUY/SELL or credit conditional stop-limit activation.
The hard dollar loss is a monitored trigger, not a guaranteed fill price.
"""
import math

POLICY = "V51_RESEARCH_RISK_CEILING_20261017"
MAX_BOOKED_LOTS = 0.40
MAX_LOSS_USD = 30.00
MAX_EQUITY_RISK_FRACTION = 0.03
EPSILON = 1e-8


class ResearchRiskBlocked(ValueError):
    pass


def positive(value, key):
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        raise ResearchRiskBlocked("EXPOSURE_INVALID_" + key)
    return float(value)


def ladder_lots(cfg):
    """Reproduce the exact engine's five fixed levels and rounding."""
    from goldtrap_arc.rules import fixed_next_lot
    lot = positive(cfg.base_lot, "BASE_LOT")
    lots = [lot]
    for _ in range(4):
        lot = positive(fixed_next_lot(lot, cfg), "LEVEL_LOT")
        lots.append(lot)
    return lots


def check_arming_plan(cfg, mode="PREARM_BOTH"):
    if mode != "PREARM_BOTH":
        raise ResearchRiskBlocked("EXPOSURE_UNREVIEWED_ARMING_MODE")
    levels = ladder_lots(cfg)
    one_side = round(sum(levels), 8)
    booked = round(one_side * 2, 8)
    if booked > MAX_BOOKED_LOTS + EPSILON:
        raise ResearchRiskBlocked("EXPOSURE_PLAN_CAP_EXCEEDED")
    return {"policy": POLICY, "baseLot": cfg.base_lot, "levels": levels,
            "oneSideLots": one_side, "grossBookedLots": booked,
            "maxGrossBookedLots": MAX_BOOKED_LOTS, "mayArm": True}


def booked_exposure(positions, orders):
    """Fail closed if the broker book is partial, ambiguous or non-finite."""
    if positions is None or orders is None:
        raise ResearchRiskBlocked("EXPOSURE_BROKER_BOOK_UNAVAILABLE")
    values = []
    for item in tuple(positions) + tuple(orders):
        val = getattr(item, "volume", None)
        values.append(positive(val, "BROKER_VOLUME"))
    return round(sum(values), 8)


def check_dispatch(positions, orders, proposed_volume):
    proposed = positive(proposed_volume, "PROPOSED_LOT")
    current = booked_exposure(positions, orders)
    if current + proposed > MAX_BOOKED_LOTS + EPSILON:
        raise ResearchRiskBlocked("EXPOSURE_DISPATCH_CAP_EXCEEDED")
    return {"bookedBeforeLots": current, "proposedLots": proposed,
            "bookedAfterLots": round(current + proposed, 8),
            "maxGrossBookedLots": MAX_BOOKED_LOTS}


def risk_ceiling(equity):
    equity = positive(equity, "EQUITY")
    limit = min(MAX_LOSS_USD, MAX_EQUITY_RISK_FRACTION * equity)
    if not math.isfinite(limit) or limit <= 0:
        raise ResearchRiskBlocked("EXPOSURE_LOSS_CAP_INVALID")
    return {"policy": POLICY, "equityAtArmingUsd": round(equity, 4),
            "maxCycleLossUsd": round(limit, 4),
            "grossBookedLotsMax": MAX_BOOKED_LOTS, "maxAccountEquityFraction": MAX_EQUITY_RISK_FRACTION}


def ensure_risk_proof(value):
    """Validate on restart rather than silently recalculating old limits."""
    if not isinstance(value, dict) or set(value) != {
        "policy", "equityAtArmingUsd", "maxCycleLossUsd",
        "grossBookedLotsMax", "maxAccountEquityFraction"
    } or value["policy"] != POLICY or value["grossBookedLotsMax"] != MAX_BOOKED_LOTS or value["maxAccountEquityFraction"] != MAX_EQUITY_RISK_FRACTION:
        raise ResearchRiskBlocked("EXPOSURE_RISK_PROOF_INVALID")
    expected = risk_ceiling(value["equityAtArmingUsd"])
    if value != expected:
        raise ResearchRiskBlocked("EXPOSURE_RISK_PROOF_CHANGED")
    return value
