"""Guarded one-line preflight evidence repair for the isolated Tradevice V5.1 clone.

Does not submit orders or change the trading strategy. Requires a pinned demo
account, flat broker, empty active-run lease and settled control receipts.
Pauses and restores only bridge / read-only observer scheduled tasks.
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
PACKAGE = Path(r"D:\GoldTrapCore\deploy_preflight_20261017\v51_dashboard_runtime.py")
BACKUPS = Path(r"D:\GoldTrapCore\deploy_preflight_20261017\backups")
TARGET = ROOT / "v51_dashboard_runtime.py"
FINGERPRINT = ROOT / "read_only" / "demo_engine_fingerprint.json"
DATABASE = ROOT / "read_only" / "demo_bridge.sqlite3"
OLD_HASH = "23e384bbd968b78cebfd47cb0d45321c4714b3f07c7457baa91798a28971287b"
NEW_HASH = "3073f14125840642a30827a135a51b5747c66e3389094cd6c9163fffe4a9d7f1"
OLD_FINGERPRINT_HASH = "70b8e244f742a5130e4763ee3772826ee60181ed5521e59f9327570585d3ad01"
SKILL_HASH = "bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee"
TASKS = ("TRADEVICE-V51-DemoBridge", "TRADEVICE-V51-ReadOnly-Observer")
REMOVED = b"  self._preflight_evidence=None\n"
ADDED = (b"  # Publish a complete evidence object only after the check finishes.\n"
         b"  # The previous object retains its original timestamp and expires normally.\n")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def source_check():
    before, after = TARGET.read_bytes(), PACKAGE.read_bytes()
    if digest(after) != NEW_HASH:
        raise ValueError("UNREVIEWED_PACKAGE")
    compile(after, str(PACKAGE), "exec")
    if digest(before) == NEW_HASH:
        return "already_installed", before, after
    if digest(before) != OLD_HASH:
        raise ValueError("UNPINNED_ENGINE_SOURCE")
    if before.count(REMOVED) != 1 or before.replace(REMOVED, ADDED) != after:
        raise ValueError("UNEXPECTED_SOURCE_DIFF")
    return "patch_ready", before, after


def fingerprint_check():
    data = FINGERPRINT.read_bytes()
    manifest = json.loads(data)
    if manifest.get("skillHash") != SKILL_HASH or not isinstance(manifest.get("files"), dict):
        raise ValueError("UNAPPROVED_SKILL_FINGERPRINT")
    for name, expected in manifest["files"].items():
        path = (ROOT / name).resolve()
        if not path.is_relative_to(ROOT.resolve()) or not path.is_file() or digest(path.read_bytes()) != expected:
            raise ValueError("FINGERPRINT_FILE_MISMATCH: " + name)
    return data, manifest


def journal_hashes():
    folder = ROOT / "logs" / "arc_v1"
    return {p: digest(p.read_bytes()) for p in folder.rglob("*")
            if p.is_file() and p.suffix in (".json", ".jsonl")} if folder.exists() else {}


def no_active_run():
    db = sqlite3.connect(DATABASE.as_uri() + "?mode=ro", uri=True, timeout=3)
    try:
        if db.execute("select request_id from active_run where singleton=1").fetchone()[0]:
            raise ValueError("ACTIVE_RUN_PRESENT")
        if db.execute("select 1 from receipts where status in (?,?) limit 1",
                      ("PROCESSING", "UNCERTAIN")).fetchone():
            raise ValueError("UNSETTLED_CONTROL_RECEIPT")
    finally:
        db.close()


def broker_flat():
    import MetaTrader5 as mt5
    if not mt5.initialize():
        raise ValueError("MT5_NOT_AVAILABLE")
    try:
        account = mt5.account_info()
        if not account or account.login != 416429834 or account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO or account.server != "Exness-MT5Trial14":
            raise ValueError("PINNED_DEMO_ACCOUNT_MISMATCH")
        for _ in range(2):
            positions, orders = mt5.positions_get(), mt5.orders_get()
            if positions is None or orders is None:
                raise ValueError("BROKER_FLATNESS_UNKNOWN")
            if positions or orders:
                raise ValueError("BROKER_HAS_POSITIONS_OR_ORDERS")
            time.sleep(0.2)
    finally:
        mt5.shutdown()


def powershell(command):
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive",
                             "-Command", command], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise ValueError("SCHEDULED_TASK_COMMAND_FAILED")
    return result.stdout.strip()


def task_state(name):
    state = powershell("(Get-ScheduledTask -TaskName '" + name +
                       "' -ErrorAction Stop).State.ToString()")
    if state not in ("Running", "Ready", "Disabled", "Queued"):
        raise ValueError("UNEXPECTED_SCHEDULED_TASK_STATE")
    return state


def change_task(name, start):
    powershell(("Start" if start else "Stop") + "-ScheduledTask -TaskName '" +
               name + "' -ErrorAction Stop")


def wait_state(name, wanted, limit=15):
    end = time.monotonic() + limit
    while time.monotonic() < end:
        if task_state(name) == wanted:
            return
        time.sleep(0.5)
    raise ValueError("TASK_STATE_NOT_CONFIRMED: " + name)


def write_in_place(path, value):
    # Preserve Windows ACL on the existing file. Backups are taken first.
    with path.open("r+b") as stream:
        stream.seek(0)
        stream.write(value)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())


def validate(during_install=False):
    status, before, after = source_check()
    fp_bytes, manifest = fingerprint_check()
    if status == "patch_ready":
        if digest(fp_bytes) != OLD_FINGERPRINT_HASH or manifest["files"].get(TARGET.name) != OLD_HASH:
            raise ValueError("UNPINNED_FINGERPRINT")
    elif manifest["files"].get(TARGET.name) != NEW_HASH:
        raise ValueError("INSTALLED_SOURCE_NOT_FINGERPRINTED")
    no_active_run()
    broker_flat()
    return status, before, after, fp_bytes, manifest


def install():
    status, before, after, fp_bytes, manifest = validate()
    if status == "already_installed":
        print(json.dumps({"status": status, "orders_sent": 0, "tasks_changed": 0}))
        return
    prior = {name: task_state(name) for name in TASKS}
    stopped = []
    error = None
    try:
        for name in TASKS:
            if prior[name] == "Running":
                change_task(name, False)
                stopped.append(name)
                wait_state(name, "Ready")
        if any(task_state(name) == "Running" for name in TASKS):
            raise ValueError("TASKS_MUST_BE_STOPPED")
        sys.path.insert(0, str(ROOT))
        from v51_batch_core import ArcRunnerLock, LOCK_KEY
        with ArcRunnerLock(lock_key=LOCK_KEY):
            checked = validate()
            if checked[0] != "patch_ready" or checked[3] != fp_bytes:
                raise ValueError("RACE_OR_FINGERPRINT_CHANGED")
            journals = journal_hashes()
            backup = BACKUPS / str(time.time_ns())
            backup.mkdir(parents=True, exist_ok=False)
            shutil.copyfile(TARGET, backup / TARGET.name)
            shutil.copyfile(FINGERPRINT, backup / FINGERPRINT.name)
            manifest["files"][TARGET.name] = NEW_HASH
            updated_fp = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
            try:
                write_in_place(TARGET, after)
                write_in_place(FINGERPRINT, updated_fp)
                if digest(TARGET.read_bytes()) != NEW_HASH:
                    raise ValueError("SOURCE_POST_VERIFY_FAILED")
                fingerprint_check()
                if journal_hashes() != journals:
                    raise ValueError("JOURNAL_HASH_CHANGED")
                no_active_run()
                broker_flat()
            except BaseException:
                write_in_place(TARGET, before)
                write_in_place(FINGERPRINT, fp_bytes)
                if digest(TARGET.read_bytes()) != OLD_HASH or digest(FINGERPRINT.read_bytes()) != OLD_FINGERPRINT_HASH:
                    raise RuntimeError("ROLLBACK_VERIFICATION_FAILED")
                raise
            print(json.dumps({
                "status": "installed",
                "source_sha256": NEW_HASH,
                "fingerprint_sha256": digest(FINGERPRINT.read_bytes()),
                "journals_preserved": len(journals),
                "orders_sent": 0,
                "new_cycles": 0,
                "backup": str(backup),
            }))
    except BaseException as exc:
        error = exc
        raise
    finally:
        failed = []
        for name in reversed(stopped):
            try:
                change_task(name, True)
                wait_state(name, "Running")
            except BaseException:
                failed.append(name)
        if failed:
            raise RuntimeError("TASK_RESTART_NEEDS_ATTENTION: " + ", ".join(failed)) from error


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true")
    action.add_argument("--install", action="store_true")
    options = parser.parse_args()
    if options.check:
        status, _, _, _, _ = validate()
        print(json.dumps({"status": status, "flat_demo_verified": True, "orders_sent": 0}))
    else:
        install()
