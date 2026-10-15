"""Install only a reviewed bundle into the isolated clone with stopped tasks.
No broker methods or receipt/journal mutations. Run after API compatibility deploy.
"""
import hashlib,json,os,shutil,sqlite3,subprocess,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def replace(source,target):
 for attempt in range(20):
  try:os.replace(source,target);return
  except PermissionError:
   if attempt==19:
    # Some Windows readers deny replacement while permitting the existing
    # file's write handle. No ACL/attribute changes: use that existing access
    # only with tasks stopped, lock held, and a verified backup available.
    data=source.read_bytes()
    with target.open('r+b') as stream:
     stream.seek(0);stream.write(data);stream.truncate();stream.flush();os.fsync(stream.fileno())
    if target.read_bytes()!=data:raise ValueError('INSTALL_WRITE_VERIFY_FAILED')
    source.unlink();return
   time.sleep(.25)
def install(package):
 package=Path(package);spec=json.loads((package/'manifest.json').read_text())
 if ROOT.name!='GoldTrapCore_v0.2_v51_research_20261013':raise ValueError('ISOLATED_CLONE_REQUIRED')
 for task in ['TRADEVICE-V51-DemoBridge','TRADEVICE-V51-ReadOnly-Observer']:
  p=subprocess.run(['powershell.exe','-NoProfile','-Command',f"(Get-ScheduledTask -TaskName '{task}').State.ToString()"],capture_output=True,text=True,check=True)
  if p.stdout.strip()=='Running':raise ValueError('TASK_MUST_BE_STOPPED')
 batch=json.loads((ROOT/'read_only/demo_batch.json').read_text())
 if batch['status'] not in ('SAFETY_STOP','STOPPED','BLOCKED','COMPLETED'):raise ValueError('ACTIVE_BATCH_INSTALL_BLOCKED')
 db=sqlite3.connect((ROOT/'read_only/demo_bridge.sqlite3').as_uri()+'?mode=ro',uri=True)
 try:
  if db.execute("select count(*) from receipts where status='PROCESSING'").fetchone()[0]:raise ValueError('CONTROL_IN_PROGRESS')
 finally:db.close()
 fingerprint=ROOT/'read_only/demo_engine_fingerprint.json'
 if sha(fingerprint)!=spec['previous_fingerprint']:raise ValueError('FINGERPRINT_CHANGED')
 original=json.loads(fingerprint.read_text())
 if not all(sha(ROOT/name)==digest for name,digest in original['files'].items()):raise ValueError('ORIGINAL_SOURCE_CHANGED')
 for name,item in spec['files'].items():
  if Path(name).name!=name:raise ValueError('INVALID_PATH')
  if sha(package/name)!=item['sha256']:raise ValueError('PACKAGE_HASH_MISMATCH')
  if item['before'] is None:
   if (ROOT/name).exists():raise ValueError('NEW_FILE_EXISTS')
  elif sha(ROOT/name)!=item['before']:raise ValueError('TARGET_CHANGED')
  compile((package/name).read_text(encoding='utf-8'),name,'exec')
 sys.path.insert(0,str(ROOT))
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 with ArcRunnerLock(lock_key=LOCK_KEY):
  paths=[p for p in (ROOT/'logs/arc_v1').rglob('*') if p.is_file() and p.suffix in ('.json','.jsonl')]
  journal_hashes={str(p.relative_to(ROOT)):sha(p) for p in paths}
  backup=ROOT/('read_only/recovery_controls_20261016_before_'+str(time.time_ns()))
  backup.mkdir(exist_ok=False)
  shutil.copyfile(fingerprint,backup/'demo_engine_fingerprint.json')
  for name,item in spec['files'].items():
   if (ROOT/name).exists():shutil.copyfile(ROOT/name,backup/name)
  (backup/'journal_hashes.json').write_text(json.dumps(journal_hashes,indent=2))
  changed=[]
  try:
   for name,item in spec['files'].items():
    temp=ROOT/(name+'.install-tmp');temp.write_bytes((package/name).read_bytes());changed.append(name);replace(temp,ROOT/name)
    if name in original['files'] or name in ('v51_account_close.py','v51_recovery_display.py'):original['files'][name]=sha(ROOT/name)
   temp=fingerprint.with_suffix('.install-tmp');temp.write_text(json.dumps(original,indent=2),encoding='utf-8');replace(temp,fingerprint)
   if any(sha(ROOT/n)!=h for n,h in journal_hashes.items()):raise ValueError('JOURNAL_CHANGED_DURING_INSTALL')
  except Exception:
   for name in reversed(changed):
    if (backup/name).exists():
     temp=ROOT/(name+'.rollback-tmp');shutil.copyfile(backup/name,temp);replace(temp,ROOT/name)
    else:(ROOT/name).unlink()
   temp=fingerprint.with_suffix('.rollback-tmp');shutil.copyfile(backup/'demo_engine_fingerprint.json',temp);replace(temp,fingerprint)
   if sha(fingerprint)!=spec['previous_fingerprint']:raise ValueError('ROLLBACK_VERIFY_FAILED')
   raise
  print(json.dumps(dict(installed=True,fingerprint=sha(fingerprint),preserved_journals=len(journal_hashes),orders_sent=0)))
if __name__=='__main__':install(Path(__file__).resolve().parent)
