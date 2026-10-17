"""Fail-closed, fingerprint-pinned V5.1 risk overlay maintenance installer.

Only the isolated V5.1 research clone is eligible, while no broker exposure,
active-run lease, or unsettled receipt exists. Does not start an execution cycle.
The cloned proprietary adapter is patched locally from a verified baseline and
is never uploaded or committed to GitHub.
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
PACKAGE = Path(r"D:\GoldTrapCore\research_20261017")
FINGERPRINT = ROOT / "read_only" / "demo_engine_fingerprint.json"
DB = ROOT / "read_only" / "demo_bridge.sqlite3"
BACKUPS = PACKAGE / "backups"
EXPECTED_MANIFEST = "f3f8e82afc4002848c645d2e4b81fcad717abe86eb8a7f4808b924bb3f0dafac"
APPROVED_SKILL = "bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee"
TASKS = ("TRADEVICE-V51-DemoBridge", "TRADEVICE-V51-ReadOnly-Observer")

SOURCE_HASHES = {
    "v51_dashboard_runtime.py": (
        "3073f14125840642a30827a135a51b5747c66e3389094cd6c9163fffe4a9d7f1",
        "18c36d7ffbf93a68ceb9faeddf9c031cc1be09a68aab917b6ffb9f38f6e5c6f9",
    ),
    "v51_batch_research.py": (
        "a5c426d59d8b7773457e6b4b4ae7b7e9e483b90ea49daad25a709da8722dc1ae",
        "7adaf25bce30baa66d52cc46f6f4f7661e67e72c557e2ecbb4a16e2af0338fc6",
    ),
    "v51_exposure_policy.py": (
        None,
        "d0d89f4a45e136b5e417201cc5ce37ffbc9c02b1e3511cd922386995096cf63d",
    ),
    "v51_loss_capped_engine.py": (
        None,
        "25fd7d86e6390f7d5e4f620283411bfdeb8b8457c21fa9bbb7573e23f6b73d33",
    ),
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def task(action, name):
    expression = {"status":"(Get-ScheduledTask -TaskName '"+name+"' -ErrorAction Stop).State.ToString()",
                  "start":"Start-ScheduledTask -TaskName '"+name+"' -ErrorAction Stop",
                  "stop":"Stop-ScheduledTask -TaskName '"+name+"' -ErrorAction Stop"}[action]
    run = subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",expression],
                         capture_output=True,text=True,timeout=30)
    if run.returncode:
        raise ValueError("SCHEDULED_TASK_ERROR:"+name+":"+action)
    return run.stdout.strip()


def wait_task(name, state):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if task("status",name)==state:
            return
        time.sleep(0.4)
    raise ValueError("SCHEDULED_TASK_STATE_MISMATCH:"+name)


def broker_flat():
    import MetaTrader5 as mt5
    if not mt5.initialize():
        raise ValueError("MT5_UNAVAILABLE")
    try:
        account=mt5.account_info()
        if (not account or account.login!=416429834 or account.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO
                or account.server!="Exness-MT5Trial14" or account.currency!="USD"):
            raise ValueError("PINNED_DEMO_ACCOUNT_MISMATCH")
        for _ in range(2):
            pos,orders=mt5.positions_get(),mt5.orders_get()
            if pos is None or orders is None:
                raise ValueError("BROKER_BOOK_UNAVAILABLE")
            if pos or orders:
                raise ValueError("BROKER_EXPOSURE_NOT_FLAT")
            time.sleep(0.2)
        return round(float(account.equity),2)
    finally:
        mt5.shutdown()


def no_active_run():
    conn=sqlite3.connect(DB.as_uri()+"?mode=ro",uri=True,timeout=3)
    try:
        row=conn.execute("select request_id from active_run where singleton=1").fetchone()
        if row is None or row[0]:
            raise ValueError("PRIOR_ACTIVE_RUN_UNCLEARED")
        if conn.execute("select 1 from receipts where status in ('PROCESSING','UNCERTAIN') limit 1").fetchone():
            raise ValueError("UNSETTLED_CONTROL")
    finally:
        conn.close()


def check_manifest():
    data=FINGERPRINT.read_bytes()
    manifest=json.loads(data)
    if manifest.get("skillHash")!=APPROVED_SKILL or not isinstance(manifest.get("files"),dict):
        raise ValueError("SKILL_IDENTITY_MISMATCH")
    for name,sha in manifest["files"].items():
        path=(ROOT/name).resolve()
        if (not path.is_relative_to(ROOT.resolve()) or not path.is_file()
                or digest(path.read_bytes())!=sha):
            raise ValueError("FINGERPRINT_MISMATCH:"+name)
    return data,manifest


def package():
    sys.path.insert(0,str(PACKAGE))
    from v51_private_adapter_risk_patch import patch_adapter
    original=(ROOT/"v51_batch_research.py").read_bytes()
    if digest(original)==SOURCE_HASHES["v51_batch_research.py"][0]:
        generated=patch_adapter(original)
        if generated!=(PACKAGE/"v51_batch_research.py").read_bytes():
            raise ValueError("PRIVATE_ADAPTER_PATCH_DIFFERENCE")
    elif digest(original)!=SOURCE_HASHES["v51_batch_research.py"][1]:
        raise ValueError("PRIVATE_ADAPTER_UNAPPROVED")
    values={}
    for name,(old,expected) in SOURCE_HASHES.items():
        local=PACKAGE/name
        if not local.is_file():
            raise ValueError("REVIEWED_PACKAGE_FILE_MISSING:"+name)
        value=local.read_bytes()
        if digest(value)!=expected:
            raise ValueError("REVIEWED_PACKAGE_HASH_MISMATCH:"+name)
        compile(value,name,"exec")
        values[name]=value
    return values


def files_state():
    statuses={}
    for name,(old,new) in SOURCE_HASHES.items():
        path=ROOT/name
        current=digest(path.read_bytes()) if path.is_file() else None
        if current==old:
            statuses[name]="old"
        elif current==new:
            statuses[name]="new"
        else:
            raise ValueError("UNPINNED_SOURCE:"+name)
    if len(set(statuses.values()))!=1:
        raise ValueError("PARTIAL_INSTALL_RECOVERY_REQUIRED")
    return next(iter(statuses.values()))


def journals():
    folder=ROOT/"logs"/"arc_v1"
    return {str(p):digest(p.read_bytes()) for p in folder.rglob("*")
            if p.is_file() and p.suffix in (".json",".jsonl")} if folder.exists() else {}


def run_unit_suite():
    env=os.environ.copy()
    env["PYTHONPATH"]=str(PACKAGE)+os.pathsep+str(ROOT)
    args=[sys.executable,"-m","unittest","-q","test_v51_research_risk",
          "test_v51_research_integration","test_v51_risk_bootstrap"]
    p=subprocess.run(args,cwd=PACKAGE,env=env,capture_output=True,text=True,timeout=40)
    if p.returncode or "Ran 17 tests" not in p.stderr or "OK" not in p.stderr:
        raise ValueError("RISK_TESTS_NOT_VERIFIED")


def check():
    reviewed=package()
    current,manifest=check_manifest()
    state=files_state()
    if state=="old":
        if digest(current)!=EXPECTED_MANIFEST:
            raise ValueError("UNPINNED_PREVIOUS_MANIFEST")
        for name,(old,_) in SOURCE_HASHES.items():
            if old is not None and name in manifest["files"] and manifest["files"][name]!=old:
                raise ValueError("UNEXPECTED_PRIOR_MANIFEST:"+name)
    else:
        if any(manifest["files"].get(name)!=new for name,(_,new) in SOURCE_HASHES.items()):
            raise ValueError("INSTALLED_MANIFEST_INCOMPLETE")
    no_active_run()
    equity=broker_flat()
    run_unit_suite()
    return {"status":"patch_ready" if state=="old" else "already_installed",
            "broker_flat":True,"demo_equity_observed_usd":equity,
            "tests_passed":17,"orders_sent":0},reviewed,current,manifest


def write(path, data, existing):
    if existing:
        # Keep existing Windows ACL rather than replacing it with a new inode.
        with path.open("r+b") as f:
            f.seek(0);f.write(data);f.truncate();f.flush();os.fsync(f.fileno())
    else:
        with path.open("xb") as f:
            f.write(data);f.flush();os.fsync(f.fileno())


def install():
    initial,reviewed,fp_bytes,manifest=check()
    if initial["status"]=="already_installed":
        print(json.dumps(initial))
        return
    states={name:task("status",name) for name in TASKS}
    if any(value not in ("Running","Ready") for value in states.values()):
        raise ValueError("UNEXPECTED_TASK_STATE")
    stopped=[]
    try:
        for name in TASKS:
            if states[name]=="Running":
                task("stop",name)
                stopped.append(name)
                wait_task(name,"Ready")
        if any(task("status",name)=="Running" for name in TASKS):
            raise ValueError("TASK_STOP_NOT_CONFIRMED")
        sys.path.insert(0,str(ROOT))
        from v51_batch_core import ArcRunnerLock,LOCK_KEY
        with ArcRunnerLock(lock_key=LOCK_KEY):
            rerun,data,current,manifest=check()
            if rerun["status"]!="patch_ready" or current!=fp_bytes:
                raise ValueError("CONCURRENT_STATE_CHANGE")
            before=journals()
            backup=BACKUPS/str(time.time_ns())
            backup.mkdir(parents=True,exist_ok=False)
            shutil.copyfile(FINGERPRINT,backup/FINGERPRINT.name)
            for name,(old,_) in SOURCE_HASHES.items():
                if old is not None:
                    shutil.copyfile(ROOT/name,backup/name)
            for name,(_,new) in SOURCE_HASHES.items():
                manifest["files"][name]=new
            updated=(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n").encode("utf-8")
            touched=[]
            try:
                for name,(old,_) in SOURCE_HASHES.items():
                    target=ROOT/name
                    write(target,data[name],old is not None)
                    touched.append((name,old is not None))
                write(FINGERPRINT,updated,True)
                if any(digest((ROOT/name).read_bytes())!=new for name,(_,new) in SOURCE_HASHES.items()):
                    raise ValueError("POST_INSTALL_SOURCE_MISMATCH")
                check_manifest()
                if journals()!=before:
                    raise ValueError("HISTORICAL_JOURNAL_CHANGED")
                no_active_run()
                broker_flat()
            except BaseException:
                for name,was_present in reversed(touched):
                    target=ROOT/name
                    if was_present:
                        write(target,(backup/name).read_bytes(),True)
                    else:
                        target.unlink(missing_ok=True)
                write(FINGERPRINT,fp_bytes,True)
                if digest(FINGERPRINT.read_bytes())!=EXPECTED_MANIFEST:
                    raise RuntimeError("ROLLBACK_MANIFEST_NOT_VERIFIED")
                raise
            print(json.dumps({
                "status":"installed",
                "fingerprint":digest(FINGERPRINT.read_bytes()),
                "journals_preserved":len(before),
                "backup":str(backup),
                "tests_passed":17,
                "orders_sent":0,"new_cycles":0,
            }))
    finally:
        failure=[]
        for name in reversed(stopped):
            try:
                task("start",name)
                wait_task(name,"Running")
            except BaseException:
                failure.append(name)
        if failure:
            raise RuntimeError("TASK_RESTART_NEEDS_MANUAL_ATTENTION:"+",".join(failure))


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check",action="store_true")
    group.add_argument("--install",action="store_true")
    opts=parser.parse_args()
    if opts.check:
        result,_,_,_=check()
        print(json.dumps(result))
    else:
        install()
