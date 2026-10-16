"""Install the tested Points basket TP mode only after reconciliation and broker-flat.

Never starts a cycle, closes a position, cancels an order or changes a receipt.
Run with --check first; --install additionally requires both tasks stopped.
"""
import argparse,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
FILES={'goldtrap_arc/config.py': ('5039ad40fcbacc35265136c3f99e4803d483b351412997d70b6e71f78565e50b', '3cfca5ea00eea3c245fccef487e04a4981b15a5c5e544e5b3398d8d3f48767bb'), 'v51_engine_diagnostics.py': ('12284eeb8bc435c5eb269cd205ed135314dd577d852f8e1576cd99b2c9f6df51', '0abf2c68e57f38a383f6d87ddc6c5d60832b722054d9821f0c1ce23d3e9feb62'), 'demo_settings.py': ('616a3a282c26edecbfeaced1558166be37cde5272560942b3571cf99caa79ca5', '1238052d559870c4bc143788078338fd4c9bd904cbf33ba6d570d4cf9bdc8046'), 'v51_execution_settings.py': ('784a7e6044aace15ea92233f744bfae24ed027da875b90a460ab0dead5e09368', 'd372a065f0d243aca1faab8f403cd9c4c85f12d92ec4c6075e5d463d3dc37b14')}
FINGERPRINT='359eedb064c02dd60c564d01dc1b265846a0799e75b7495ba0920596d4e63c5f'
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
 from apply_execution_settings import patched
 package=Path(__file__).parent/'patches/20261016_points_tp'
 value=patched(data,(package/(name.replace('/','__')+'.patch')).read_text())
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
  backup=ROOT/'read_only'/('points_tp_before_'+str(time.time_ns()));backup.mkdir()
  for name,(before,_) in changes.items():
   if before is not None:
    (backup/name).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,backup/name)
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
