"""Install the tested M1 defer fix only after reconciliation and broker-flat.

Never starts a cycle, closes a position, cancels an order or changes a receipt.
Run with --check first; --install additionally requires both tasks stopped.
"""
import argparse,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
BEFORE='22e67057fabacef43aaece36ba318868acd4c3594955bc0f9bfccea5ad23bf47'
AFTER='899df4b098d6c41357b9d18ef1204f5012ca5624263e900d64cbbb58d8bb29ad'
FINGERPRINT='b723859fa6ccc649e52cd507b99956663edb569ac58e29a03dd77194bd2ed50f'
OLD=b'        except (ArcSafetyError,ValueError,TypeError):\n'
NEW=b'''        except (ArcM1BoundaryWait,ArcSafetyError,ValueError,TypeError):
            # M1 publication lag is an unavailable ATR sample, not a terminal
            # cycle failure. Keep the previous verified target and supervision;
            # callers defer ATR-dependent entries/updates until a valid sample.
'''
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
def replacement(data):
 if digest(data)!=BEFORE or data.count(OLD)!=1:raise ValueError('SOURCE_CHANGED')
 value=data.replace(OLD,NEW)
 if digest(value)!=AFTER:raise ValueError('PATCH_HASH_MISMATCH')
 compile(value,'goldtrap_arc/execution.py','exec')
 return value
def main(install=False):
 fingerprint=ROOT/'read_only/demo_engine_fingerprint.json'
 original=fingerprint.read_bytes()
 if digest(original)!=FINGERPRINT:raise ValueError('FINGERPRINT_CHANGED')
 manifest=json.loads(original)
 for name,expected in manifest['files'].items():
  if digest((ROOT/name).read_bytes())!=expected:raise ValueError('SOURCE_CHANGED: '+name)
 target=ROOT/'goldtrap_arc/execution.py';before=target.read_bytes();after=replacement(before)
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
  print(json.dumps(dict(ready=True,orders_sent=0,source_sha256=AFTER)));return
 for task in ['TRADEVICE-V51-DemoBridge','TRADEVICE-V51-ReadOnly-Observer']:
  p=subprocess.run(['powershell.exe','-NoProfile','-Command',f"(Get-ScheduledTask -TaskName '{task}').State.ToString()"],capture_output=True,text=True,check=True)
  if p.stdout.strip()=='Running':raise ValueError('TASK_MUST_BE_STOPPED')
 sys.path.insert(0,str(ROOT))
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 with ArcRunnerLock(lock_key=LOCK_KEY):
  journals={p:digest(p.read_bytes()) for p in (ROOT/'logs/arc_v1').rglob('*') if p.is_file() and p.suffix in ('.json','.jsonl')}
  backup=ROOT/'read_only'/('m1_boundary_before_'+str(time.time_ns()));backup.mkdir()
  shutil.copyfile(target,backup/'execution.py');shutil.copyfile(fingerprint,backup/'demo_engine_fingerprint.json')
  manifest['files']['goldtrap_arc/execution.py']=AFTER
  try:
   temp=target.with_suffix('.install-tmp');temp.write_bytes(after);replace(temp,target)
   temp=fingerprint.with_suffix('.install-tmp');temp.write_text(json.dumps(manifest,indent=2),encoding='utf-8');replace(temp,fingerprint)
   if digest(target.read_bytes())!=AFTER or any(digest(p.read_bytes())!=h for p,h in journals.items()):raise ValueError('POST_INSTALL_VERIFICATION_FAILED')
  except BaseException:
   target.write_bytes(before);fingerprint.write_bytes(original);raise
  print(json.dumps(dict(installed=True,fingerprint=digest(fingerprint.read_bytes()),preserved_journals=len(journals),orders_sent=0,new_cycle_started=False)))
if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--check',action='store_true');g.add_argument('--install',action='store_true')
 main(p.parse_args().install)
