"""Install the tested telemetry cadence and ADX display feed only after reconciliation and broker-flat.

Never starts a cycle, closes a position, cancels an order or changes a receipt.
Run with --check first; --install additionally requires both tasks stopped.
"""
import argparse,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
FILES={'bridge.py': ('8a24e384649429f56766b93492321ca1c4101894fe98a856f6b90fa02bbf6f1e', '0459ebce31902405b8775663efb1aa56e09efa5fb32c178117df5433b0c4babd'), 'v51_observed_engine.py': ('e977758a545a2f25c1549db3d7453d867dfd8946fe8d47272d4e62ee09863aee', 'cf396629eab38028a17a3eacafa63a850c2ad734f283970ad6ce96e32d6f5619'), 'v51_observer_service.py': ('3058d27e871702834c407cb22ae009dc1eb7b2276227e2e9a29ee4128098ded0', '9fdcb4cb00ca64f0ca2112a99ae5df42b54095883a29d6f8538a8ce1e2a4c98e'), 'v51_staging_readonly_forwarder.py': ('dca92c49677e56351fd1127281cade014f79ea8c19d72544731e9cba228ef156', '5db58a913d8e2b5cb830844ea8581384d75bfaa356dac708055ca5f3987f5d82'), 'v51_mt5_readonly_snapshot.py': ('f0bdeaac4040e863195bbdcd1b703f08f1395584895617c0b7bf7d441826473f', 'af9fcbb46df449d70cedd305cc77d3068239e734fd853570929778bbb7f5dfd6'), 'read_only/terminal_mirror_20261015/viewer.py': ('bdc03b25401a438d694a4bb25bf29414256d667c46cc53c62332d2a51618507d', 'eba76f6d2924560205d3f222c330d520737b9437319edbdd274b2ab688a57fcd'), 'read_only/growth_observer_20261015/history.py': ('983c1c65137ddd549dcdac8734372a13010ce41565008a477494599216ed1d71', '52eb1777dca2fbeb4a69157f7243f47572f7654c7e42a6a3d30786d701effadd')}
FINGERPRINT='d51625fdaaf0626e692063f534ab49da5eaa9b15d61d6a38203abb196e60e3a1'
def digest(data):return hashlib.sha256(data).hexdigest()
def replace(source,target):
 # Some Windows readers deny replacement but permit writing the existing file.
 # Keep its existing ACL; tasks are stopped, lock held and backup verified.
 for attempt in range(20):
  try:os.replace(source,target);return
  except PermissionError:
   if attempt<19:time.sleep(.25);continue
   value=source.read_bytes()
   with target.open('r+b') as stream:
    stream.seek(0);stream.write(value);stream.truncate();stream.flush();os.fsync(stream.fileno())
   if target.read_bytes()!=value:raise ValueError('INSTALL_WRITE_VERIFY_FAILED')
   source.unlink();return
def replacement(name,data):
 if data is None or digest(data)!=FILES[name][0]:raise ValueError('SOURCE_CHANGED: '+name)
 bundle=json.loads((Path(__file__).parent/'telemetry_bundle.json').read_text(encoding='utf-8'))
 value=bundle[name]['content'].encode('utf-8')
 if digest(value)!=FILES[name][1]:raise ValueError('PACKAGE_HASH_MISMATCH: '+name)
 compile(value,name,'exec')
 return value

def main(install=False):
 fingerprint=ROOT/'read_only/demo_engine_fingerprint.json'
 original=fingerprint.read_bytes()
 if digest(original)!=FINGERPRINT:raise ValueError('FINGERPRINT_CHANGED')
 manifest=json.loads(original)
 for name,expected in manifest['files'].items():
  if digest((ROOT/name).read_bytes())!=expected:raise ValueError('SOURCE_CHANGED: '+name)
 changes={}
 for name in FILES:
  before=(ROOT/name).read_bytes() if (ROOT/name).exists() else None
  changes[name]=(before,replacement(name,before))
 db=sqlite3.connect((ROOT/'read_only/demo_bridge.sqlite3').as_uri()+'?mode=ro',uri=True)
 try:
  if db.execute('select request_id from active_run where singleton=1').fetchone()[0]:raise ValueError('PRIOR_RUN_RECONCILIATION_REQUIRED')
  if db.execute("select 1 from receipts where status in ('PROCESSING','UNCERTAIN') limit 1").fetchone():raise ValueError('UNSETTLED_CONTROL')
 finally:db.close()
 import MetaTrader5 as mt5
 if not mt5.initialize():raise ValueError('MT5_UNAVAILABLE')
 try:
  account=mt5.account_info()
  if account is None or account.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO or account.server!='Exness-MT5Trial14':raise ValueError('DEMO_IDENTITY_REQUIRED')
  for _ in range(2):
   positions,orders=mt5.positions_get(),mt5.orders_get()
   if positions is None or orders is None or positions or orders:raise ValueError('BROKER_NOT_FLAT')
   time.sleep(.2)
 finally:mt5.shutdown()
 if not install:
  print(json.dumps(dict(ready=True,orders_sent=0,source_sha256={k:v[1] for k,v in FILES.items()})));return
 for task in ['TRADEVICE-V51-DemoBridge','TRADEVICE-V51-ReadOnly-Observer','TRADEVICE-V51-Growth-ReadOnly','TRADEVICE-V51-TerminalJournal-ReadOnly']:
  p=subprocess.run(['powershell.exe','-NoProfile','-Command',f"(Get-ScheduledTask -TaskName '{task}').State.ToString()"],capture_output=True,text=True,check=True)
  if p.stdout.strip()=='Running':raise ValueError('TASK_MUST_BE_STOPPED')
 sys.path.insert(0,str(ROOT))
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 with ArcRunnerLock(lock_key=LOCK_KEY):
  journals={p:digest(p.read_bytes()) for p in (ROOT/'logs/arc_v1').rglob('*') if p.is_file() and p.suffix in ('.json','.jsonl')}
  backup=ROOT/'read_only'/('fast_telemetry_before_'+str(time.time_ns()));backup.mkdir()
  for name,(before,_) in changes.items():
   if before is not None:
    (backup/name).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,backup/name)
   if name in manifest['files']:manifest['files'][name]=FILES[name][1]
  shutil.copyfile(fingerprint,backup/'demo_engine_fingerprint.json')
  try:
   for name,(_,after) in changes.items():
    target=ROOT/name;temp=target.with_suffix('.install-tmp');temp.write_bytes(after);replace(temp,target)
   temp=fingerprint.with_suffix('.install-tmp');temp.write_text(json.dumps(manifest,indent=2),encoding='utf-8');replace(temp,fingerprint)
   if any(digest((ROOT/name).read_bytes())!=FILES[name][1] for name in changes) or any(digest(p.read_bytes())!=h for p,h in journals.items()):raise ValueError('POST_INSTALL_VERIFICATION_FAILED')
  except BaseException:
   for name,(before,_) in changes.items():
    if before is None:(ROOT/name).unlink(missing_ok=True)
    else:(ROOT/name).write_bytes(before)
   fingerprint.write_bytes(original);raise
  print(json.dumps(dict(installed=True,fingerprint=digest(fingerprint.read_bytes()),preserved_journals=len(journals),orders_sent=0,new_cycle_started=False)))
if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--check',action='store_true');g.add_argument('--install',action='store_true')
 main(p.parse_args().install)
