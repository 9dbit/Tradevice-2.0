"""Install the tested ATR/ADX entry filter only after reconciliation and broker-flat.

Never starts a cycle, closes a position, cancels an order or changes a receipt.
Run with --check first; --install additionally requires both tasks stopped.
"""
import argparse,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
FILES={'v51_dashboard_runtime.py': ('592b32c309e2b7181edd3bbe9f0f1328e7d1e277a69affef9971a8e95fd37414', 'ce08ad52e763f954800fca7ba5854d232b9daba07bf6f161c2631f17892b659d'), 'bridge.py': ('08a6562fdbd3eec040ed1ea2e036e6a24cbb8897d0b656cd47f3e0f1be512604', '8a24e384649429f56766b93492321ca1c4101894fe98a856f6b90fa02bbf6f1e'), 'v51_batch_core.py': ('dd4733580c65ee637fce8d0fd28de280c93d4518490f221ecdb13ae8700a4bf5', '83371046c523ee1b90f5057a7ec495bcd2429b758d0ec8cfec366e707b6889c9'), 'v51_market_preflight.py': (None, '050a974e7047246d321114058a77d1d0ea57147383cff944627f0ecc8e1fb392')}
FINGERPRINT='5aada8f2977ecc812f1b71dcac88a85a922ee59ecccaaebbd80217286ad88697'
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
 expected=FILES[name][0]
 if (data is not None if expected is None else data is None or digest(data)!=expected):raise ValueError('SOURCE_CHANGED: '+name)
 if name=='v51_batch_core.py':
  value=data.replace(b'        admission(adapter)\n        if resume:',b'        if admission(adapter) is False:\n            account_book(adapter, flat=True)\n            return 0  # No cycle reserved and no broker dispatch.\n        if resume:',1)
  value=value.replace(b'                    admission(adapter)\n                    connection_read',b"                    if admission(adapter) is False:\n                        account_book(adapter, flat=True)\n                        m.update(status='STOPPED_ENTRY_PREFLIGHT', ended_at=utc(), no_new_cycle=True)\n                        break  # Prior cycle has reconciled; never reserve a new slot.\n                    connection_read",1)
 else:value=(Path(__file__).parent/name).read_bytes()
 if digest(value)!=FILES[name][1]:raise ValueError('PATCH_HASH_MISMATCH: '+name)
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
 for task in ['TRADEVICE-V51-DemoBridge','TRADEVICE-V51-ReadOnly-Observer']:
  p=subprocess.run(['powershell.exe','-NoProfile','-Command',f"(Get-ScheduledTask -TaskName '{task}').State.ToString()"],capture_output=True,text=True,check=True)
  if p.stdout.strip()=='Running':raise ValueError('TASK_MUST_BE_STOPPED')
 sys.path.insert(0,str(ROOT))
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 with ArcRunnerLock(lock_key=LOCK_KEY):
  journals={p:digest(p.read_bytes()) for p in (ROOT/'logs/arc_v1').rglob('*') if p.is_file() and p.suffix in ('.json','.jsonl')}
  backup=ROOT/'read_only'/('market_preflight_before_'+str(time.time_ns()));backup.mkdir()
  for name,(before,_) in changes.items():
   if before is not None:shutil.copyfile(ROOT/name,backup/name)
   manifest['files'][name]=FILES[name][1]
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
