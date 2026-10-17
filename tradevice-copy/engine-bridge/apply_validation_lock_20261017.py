"""Guarded maintenance installer for the isolated V5.1 validation lock.

No order_send, no START request and no broker configuration changes. Only
bridge.py, v51_demo_batch_runtime.py, a new validation_gate.py, and their
fingerprint entries change. The old engine, all journals and paper broker
data remain untouched. Requires a pinned demo account flat on two reads.
"""
import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013")
PACKAGE = Path(r"D:\GoldTrapCore\research_20261017\validation_lock_review\Tradevice-2.0-fix-v51-validation-lock-20261017\tradevice-copy\engine-bridge")
FINGERPRINT = ROOT / "read_only" / "demo_engine_fingerprint.json"
DATABASE = ROOT / "read_only" / "demo_bridge.sqlite3"
BACKUP_ROOT = Path(r"D:\GoldTrapCore\research_20261017\validation_lock_review\backups")
OLD_MANIFEST = "c1b95a37e5a161ad886b8b7d1413d4009fc8a51121912ddfa0b03aa1a1e908b8"
APPROVED_SKILL = "bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee"

# All hashes below were measured on TRADEVICEPC against the intended commit.
FILES = {
    "bridge.py": ("d0025feb6d71e6371251f176183d7b03177b24cb4997013402917de2bde738dc", "803d0bbf432156e47c6897ccc06e48a8f7b957fe354253a76874dc4a3f1fb729"),
    "v51_demo_batch_runtime.py": ("f75dbe2853fdcc453458e9636f339019f41066224bed55618104a53c498dedab", "7f3fb6d1aaed454282406fd9ad31e0e1cf36399ec226974cb44f54f872d45308"),
    "validation_gate.py": (None, "6511704fcef4be2a3676354d7adcf0de16af8265206f07fa03817f7a073e1253"),
}
TASKS = ("TRADEVICE-V51-DemoBridge", "TRADEVICE-V51-ReadOnly-Observer")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def reviewed_sources():
    sources = {}
    for name, (_, new_hash) in FILES.items():
        p = PACKAGE / name
        if not p.is_file():
            raise ValueError("VALIDATION_LOCK_PACKAGE_MISSING: " + name)
        data = p.read_bytes()
        if digest(data) != new_hash:
            raise ValueError("VALIDATION_LOCK_PACKAGE_HASH_MISMATCH: " + name)
        compile(data, str(p), "exec")
        sources[name] = data
    # Gate is not unlockable by an environment variable or a remote payload.
    policy = sources["validation_gate.py"]
    if b'AUTOMATIC_BLOCKER = "AUTOMATIC_VALIDATION_REQUIRED"' not in policy:
        raise ValueError("VALIDATION_LOCK_POLICY_INVALID")
    return sources


def manifest_verify():
    data = FINGERPRINT.read_bytes()
    obj = json.loads(data)
    if obj.get("skillHash") != APPROVED_SKILL or not isinstance(obj.get("files"), dict):
        raise ValueError("VALIDATION_LOCK_SKILL_HASH_MISMATCH")
    for relative, expected in obj["files"].items():
        path = (ROOT / relative).resolve()
        if not path.is_relative_to(ROOT.resolve()) or not path.is_file():
            raise ValueError("VALIDATION_LOCK_UNEXPECTED_FILE: " + relative)
        if digest(path.read_bytes()) != expected:
            raise ValueError("VALIDATION_LOCK_FINGERPRINT_MISMATCH: " + relative)
    return data, obj


def installation_state():
    states = []
    for name, (before, after) in FILES.items():
        path = ROOT / name
        actual = digest(path.read_bytes()) if path.is_file() else None
        if actual == before:
            states.append("old")
        elif actual == after:
            states.append("new")
        else:
            raise ValueError("VALIDATION_LOCK_UNREVIEWED_SOURCE: " + name)
    if len(set(states)) != 1:
        raise ValueError("VALIDATION_LOCK_PARTIALLY_INSTALLED")
    return states[0]


def verify_journals():
    folder = ROOT / "logs" / "arc_v1"
    if not folder.is_dir():
        raise ValueError("VALIDATION_LOCK_JOURNAL_ROOT_MISSING")
    return {str(p.relative_to(folder)): digest(p.read_bytes()) for p in folder.rglob("*")
            if p.is_file() and p.suffix in (".json", ".jsonl")}


def no_unsettled_controls():
    db = sqlite3.connect(DATABASE.as_uri() + "?mode=ro", uri=True, timeout=3)
    try:
        active = db.execute("SELECT request_id FROM active_run WHERE singleton=1").fetchone()
        if active is None or active[0] is not None:
            raise ValueError("VALIDATION_LOCK_ACTIVE_RUN")
        rows = db.execute("SELECT 1 FROM receipts WHERE status IN ('PROCESSING','UNCERTAIN') LIMIT 1").fetchone()
        if rows is not None:
            raise ValueError("VALIDATION_LOCK_UNCERTAIN_RECEIPTS")
    finally:
        db.close()


def flat_demo():
    import MetaTrader5 as mt5
    if not mt5.initialize():
        raise ValueError("VALIDATION_LOCK_MT5_OFFLINE")
    try:
        a = mt5.account_info()
        if (a is None or a.login != 416429834
                or a.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO
                or a.server != "Exness-MT5Trial14" or a.currency != "USD"):
            raise ValueError("VALIDATION_LOCK_DEMO_IDENTITY_MISMATCH")
        for _ in range(2):
            p, o = mt5.positions_get(), mt5.orders_get()
            if p is None or o is None:
                raise ValueError("VALIDATION_LOCK_BROKER_BOOK_UNKNOWN")
            if p or o:
                raise ValueError("VALIDATION_LOCK_BROKER_NOT_FLAT")
            time.sleep(0.25)
        return round(float(a.equity), 2)
    finally:
        mt5.shutdown()


def guard_emergency():
    sys.path.insert(0, str(ROOT))
    from emergency_state import requested
    if requested(ROOT):
        raise ValueError("VALIDATION_LOCK_EMERGENCY_INTENT_ACTIVE")


def run_powershell(command):
    process = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True, text=True, timeout=25)
    if process.returncode:
        raise ValueError("VALIDATION_LOCK_SCHEDULED_TASK_FAILURE")
    return process.stdout.strip()


def task_state(name):
    state = run_powershell(
        "(Get-ScheduledTask -TaskName '" + name + "' -ErrorAction Stop).State.ToString()")
    if state not in ("Ready", "Running"):
        raise ValueError("VALIDATION_LOCK_TASK_STATE_UNEXPECTED: " + name)
    return state


def task_switch(name, action):
    run_powershell(action + "-ScheduledTask -TaskName '" + name + "' -ErrorAction Stop")
    desired = "Ready" if action == "Stop" else "Running"
    for _ in range(40):
        if task_state(name) == desired:
            return
        time.sleep(.5)
    raise ValueError("VALIDATION_LOCK_TASK_TRANSITION_TIMEOUT: " + name)


def write(path, data, existing):
    if existing:
        # Retain Windows ACL on the original files.
        with path.open("r+b") as stream:
            stream.seek(0)
            stream.write(data)
            stream.truncate()
            stream.flush()
            os.fsync(stream.fileno())
    else:
        with path.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())


def inspect():
    payload = reviewed_sources()
    raw, manifest = manifest_verify()
    mode = installation_state()
    if mode == "old":
        if digest(raw) != OLD_MANIFEST:
            raise ValueError("VALIDATION_LOCK_MANIFEST_NOT_PINNED")
        for name, (prior, _) in FILES.items():
            if manifest["files"].get(name) != prior:
                raise ValueError("VALIDATION_LOCK_PREVIOUS_HASH_NOT_PINNED: " + name)
    else:
        for name, (_, target) in FILES.items():
            if manifest["files"].get(name) != target:
                raise ValueError("VALIDATION_LOCK_NEW_HASH_NOT_PINNED: " + name)
    no_unsettled_controls()
    guard_emergency()
    equity = flat_demo()
    return {
        "status": "patch_ready" if mode == "old" else "already_installed",
        "account_mode": "demo",
        "broker_flat_confirmed": True,
        "equity_observed_usd": equity,
        "automatic": "LOCKED_VALIDATION_PENDING",
        "orders_sent": 0,
    }, payload, raw, manifest


def install():
    status, payload, fingerprint_bytes, manifest = inspect()
    if status["status"] == "already_installed":
        print(json.dumps(status))
        return
    prior = {name: task_state(name) for name in TASKS}
    stopped = []
    try:
        for name in TASKS:
            if prior[name] == "Running":
                task_switch(name, "Stop")
                stopped.append(name)
        sys.path.insert(0, str(ROOT))
        from v51_batch_core import ArcRunnerLock, LOCK_KEY
        with ArcRunnerLock(lock_key=LOCK_KEY):
            observed, payload2, current, manifest = inspect()
            if observed["status"] != "patch_ready" or current != fingerprint_bytes:
                raise ValueError("VALIDATION_LOCK_CONCURRENT_FILE_CHANGE")
            before = verify_journals()
            backup = BACKUP_ROOT / str(time.time_ns())
            backup.mkdir(parents=True, exist_ok=False)
            shutil.copyfile(FINGERPRINT, backup / "demo_engine_fingerprint.json")
            for name, (prior_hash, _) in FILES.items():
                if prior_hash:
                    shutil.copyfile(ROOT / name, backup / name)
            for name, (_, target_hash) in FILES.items():
                manifest["files"][name] = target_hash
            new_fingerprint = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
            touched = []
            try:
                for name, (prior_hash, _) in FILES.items():
                    touched.append((name, prior_hash is not None))
                    write(ROOT / name, payload[name], existing=prior_hash is not None)
                write(FINGERPRINT, new_fingerprint, existing=True)
                manifest_verify()
                from v51_dashboard_runtime import Runtime
                rt = Runtime.__new__(Runtime)
                rt.root = ROOT
                rt.fingerprint()
                if verify_journals() != before:
                    raise ValueError("VALIDATION_LOCK_JOURNALS_CHANGED")
                no_unsettled_controls()
                flat_demo()
                guard_emergency()
                from validation_gate import status as lock_status
                if lock_status()["automaticAllowed"] is not False:
                    raise ValueError("VALIDATION_LOCK_POLICY_WAS_NOT_ENFORCED")
            except BaseException:
                for name, existed in reversed(touched):
                    if existed:
                        write(ROOT / name, (backup / name).read_bytes(), existing=True)
                    else:
                        (ROOT / name).unlink(missing_ok=True)
                write(FINGERPRINT, fingerprint_bytes, existing=True)
                if digest(FINGERPRINT.read_bytes()) != OLD_MANIFEST:
                    raise RuntimeError("VALIDATION_LOCK_ROLLBACK_VERIFICATION_FAILED")
                manifest_verify()
                raise
            print(json.dumps({
                "status": "installed",
                "fingerprint_sha256": digest(FINGERPRINT.read_bytes()),
                "journal_files_preserved": len(before),
                "backup": str(backup),
                "orders_sent": 0,
                "cycles_started": 0,
                "automatic": "LOCKED_VALIDATION_PENDING",
            }))
    finally:
        failures = []
        for name in reversed(stopped):
            try:
                task_switch(name, "Start")
            except BaseException:
                failures.append(name)
        if failures:
            raise RuntimeError("VALIDATION_LOCK_TASK_RESTART_FAILED: " + ", ".join(failures))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--install", action="store_true")
    args = parser.parse_args()
    if args.check:
        status, _, _, _ = inspect()
        print(json.dumps(status))
    else:
        install()
