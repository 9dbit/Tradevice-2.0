"""Fail-closed V5.1 validation lock for Automatic and multi-cycle UAT.

There is intentionally no approval flag, environment-variable override, token,
date-based expiry, or unlock endpoint. A later audited release must replace
this policy with verified, version-bound broker UAT and out-of-sample evidence.
"""
PROTOCOL = "V51_VALIDATION_LOCK_20261017"
AUTOMATIC_BLOCKER = "AUTOMATIC_VALIDATION_REQUIRED"
CUSTOM_BLOCKER = "VALIDATION_SINGLE_CYCLE_ONLY"
MAX_CUSTOM_CYCLES = 1

def automatic_blocker():
    return AUTOMATIC_BLOCKER

def start_blocker(mode, target_cycles):
    if mode == "AUTOMATIC":
        return automatic_blocker()
    if mode not in (None, "CUSTOM"):
        return "CYCLE_MODE_INVALID"
    if type(target_cycles) is not int or target_cycles != MAX_CUSTOM_CYCLES:
        return CUSTOM_BLOCKER
    return None

def status():
    return {
        "protocol": PROTOCOL,
        "status": "LOCKED_VALIDATION_PENDING",
        "automaticAllowed": False,
        "reason": AUTOMATIC_BLOCKER,
        "maxCustomCycles": MAX_CUSTOM_CYCLES,
        "approvalId": None,
        "requiredEvidence": ["BROKER_UAT", "FULL_EXECUTION_REPLAY", "OUT_OF_SAMPLE"],
    }

def valid_status(value):
    return (isinstance(value, dict) and value == status()
            and value.get("automaticAllowed") is False
            and type(value.get("maxCustomCycles")) is int)
