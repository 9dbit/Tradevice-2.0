"""Install the tested margin diagnostic fix only after reconciliation and broker-flat.

Never starts a cycle, closes a position, cancels an order or changes a receipt.
Run with --check first; --install additionally requires both tasks stopped.
"""
import argparse,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
FILES={'v51_dashboard_runtime.py': ('c7593d3fc9ad3ac66989b93a49b54af381f02edc19af8b029e49e1493615a674', '592b32c309e2b7181edd3bbe9f0f1328e7d1e277a69affef9971a8e95fd37414'), 'bridge.py': ('62b4e471a2881a4f64d2fe4db007c7e74a951181d3ffc28c0667ebff1bce25a2', '08a6562fdbd3eec040ed1ea2e036e6a24cbb8897d0b656cd47f3e0f1be512604'), 'v51_batch_research.py': ('a33bb4b5302e2e36dd82f2d587be5e95866dd6a9f568b05f13a1ef909731fafd', 'a5c426d59d8b7773457e6b4b4ae7b7e9e483b90ea49daad25a709da8722dc1ae')}
FINGERPRINT='83d4b84db95f4c4ce99af9c042b964ef7f5eff7b39e91afadc4990dbe88c2e77'
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
 if digest(data)!=FILES[name][0]:raise ValueError('SOURCE_CHANGED: '+name)
 if name=='v51_batch_research.py':
  value=data.replace(b'def margin_envelope(adapter):',b'def margin_envelope(adapter,evidence=None):')
  value=value.replace(b" if free<worst+reserve:raise ArcSafetyError",b" if evidence is not None:\n  used=finite(account.margin)\n  evidence.update(currency='USD',freeMargin=free,usedMargin=used,exposureMargin=worst,reserve=reserve,\n   requiredFreeMargin=worst+reserve,minimumEquity=used+worst+reserve,shortfall=max(0.,worst+reserve-free))\n if free<worst+reserve:raise ArcSafetyError")
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
 changes={name:((ROOT/name).read_bytes(),replacement(name,(ROOT/name).read_bytes())) for name in FILES}
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
  backup=ROOT/'read_only'/('preflight_requirements_before_'+str(time.time_ns()));backup.mkdir()
  for name in changes:shutil.copyfile(ROOT/name,backup/name);manifest['files'][name]=FILES[name][1]
  shutil.copyfile(fingerprint,backup/'demo_engine_fingerprint.json')
  try:
   for name,(_,after) in changes.items():
    target=ROOT/name;temp=target.with_suffix('.install-tmp');temp.write_bytes(after);replace(temp,target)
   temp=fingerprint.with_suffix('.install-tmp');temp.write_text(json.dumps(manifest,indent=2),encoding='utf-8');replace(temp,fingerprint)
   if any(digest((ROOT/name).read_bytes())!=FILES[name][1] for name in changes) or any(digest(p.read_bytes())!=h for p,h in journals.items()):raise ValueError('POST_INSTALL_VERIFICATION_FAILED')
  except BaseException:
   for name,(before,_) in changes.items():(ROOT/name).write_bytes(before)
   fingerprint.write_bytes(original);raise
  print(json.dumps(dict(installed=True,fingerprint=digest(fingerprint.read_bytes()),preserved_journals=len(journals),orders_sent=0,new_cycle_started=False)))
if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--check',action='store_true');g.add_argument('--install',action='store_true')
 main(p.parse_args().install)
