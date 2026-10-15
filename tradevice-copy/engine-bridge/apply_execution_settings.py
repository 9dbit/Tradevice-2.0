"""Install reviewed clone-only patches while broker-flat; never starts a run."""
import argparse,hashlib,json,os,re,shutil,sqlite3,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')

def sha(data):return hashlib.sha256(data).hexdigest()

def patched(before,diff):
 lines=before.decode().replace('\r\n','\n').splitlines(True);out=[];cursor=0
 chunks=diff.splitlines(True);i=2
 while i<len(chunks):
  match=re.fullmatch(r'@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@\n',chunks[i])
  if not match:raise ValueError('PATCH_HEADER_INVALID')
  start=max(0,int(match[1])-1)
  if start<cursor:raise ValueError('PATCH_OVERLAP')
  out.extend(lines[cursor:start]);cursor=start;i+=1
  while i<len(chunks) and not chunks[i].startswith('@@ '):
   marker=chunks[i][0];text=chunks[i][1:]
   if marker in ' -':
    if cursor>=len(lines) or lines[cursor]!=text:raise ValueError('PATCH_CONTEXT_CHANGED')
    cursor+=1
   if marker in ' +':out.append(text)
   if marker not in ' +-':raise ValueError('PATCH_LINE_INVALID')
   i+=1
 out.extend(lines[cursor:]);return ''.join(out).encode()

def prepare(root,package):
 manifest=json.loads((package/'manifest.json').read_text());prepared={}
 for name,entry in manifest['files'].items():
  dest=(root/name).resolve()
  if not dest.is_relative_to(root.resolve()) or not name.endswith('.py'):raise ValueError('PATCH_PATH_INVALID')
  old=dest.read_bytes() if dest.exists() else b''
  if (sha(old) if dest.exists() else None)!=entry['before_sha256']:raise ValueError('PATCH_BASELINE_CHANGED: '+name)
  new=patched(old,(package/entry['patch']).read_text())
  if sha(new)!=entry['after_sha256']:raise ValueError('PATCH_RESULT_MISMATCH: '+name)
  compile(new,name,'exec');prepared[name]=new
 return manifest,prepared

def main():
 p=argparse.ArgumentParser();p.add_argument('--package',type=Path,required=True);args=p.parse_args()
 sys.path.insert(0,str(ROOT))
 from bridge import ProcessLock
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 from goldtrap_arc.mt5_adapter import MT5ArcAdapter
 from goldtrap_arc.persistence import atomic_json
 import MetaTrader5 as mt5
 fp=ROOT/'read_only/demo_engine_fingerprint.json'
 with ProcessLock(ROOT/'read_only/demo_bridge.lock'),ArcRunnerLock(lock_key=LOCK_KEY):
  manifest,prepared=prepare(ROOT,args.package)
  if sha(fp.read_bytes())!=manifest['baseline_fingerprint_sha256']:raise ValueError('FINGERPRINT_CHANGED_REVIEW_REQUIRED')
  current=json.loads(fp.read_text())
  if not all(sha((ROOT/name).read_bytes())==digest for name,digest in current['files'].items()):raise ValueError('ENGINE_FILES_CHANGED')
  db=sqlite3.connect('file:'+str(ROOT/'read_only/demo_bridge.sqlite3')+'?mode=ro',uri=True)
  adapter=MT5ArcAdapter(mt5,allow_execution=False)
  try:
   if db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()[0] is not None:raise ValueError('ACTIVE_RUN_BLOCKS_INSTALL')
   if db.execute("SELECT 1 FROM receipts WHERE status IN ('PROCESSING','UNCERTAIN')").fetchone():raise ValueError('UNSETTLED_COMMAND_BLOCKS_INSTALL')
   adapter.initialize();adapter.guard_identity()
   for _ in range(2):
    positions,orders=mt5.positions_get(),mt5.orders_get()
    if positions is None or orders is None or positions or orders:raise ValueError('BROKER_NOT_FLAT')
    time.sleep(.1)
   backup=args.package/('before_install_'+str(time.time_ns()));backup.mkdir(exist_ok=False)
   shutil.copyfile(fp,backup/fp.name)
   for name in prepared:
    src=ROOT/name
    if src.exists():
     dest=backup/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
   # Bridge and runner locks exclude execution until all reviewed files and the
   # fingerprint are in place. Partial failures remain fingerprint-blocked.
   for name,content in prepared.items():
    dest=ROOT/name
    # Preserve Windows ACLs on existing files. Source writes occur only while
    # bridge/runner locks are held; fingerprint is committed after all files.
    if dest.exists() and dest.stat().st_nlink!=1:raise ValueError('LINKED_SOURCE_REFUSED')
    with dest.open('wb') as out:
     out.write(content);out.flush();os.fsync(out.fileno())
    if sha(dest.read_bytes())!=sha(content):raise ValueError('INSTALLED_HASH_MISMATCH')
    current['files'][name]=sha(content)
   atomic_json(fp,current)
   receipt=dict(installed_files={k:sha(v) for k,v in prepared.items()},fingerprint_sha256=sha(fp.read_bytes()),broker_flat=True,new_cycle_started=False,old_journals_modified=False,observed_ms=int(time.time()*1000))
   atomic_json(args.package/'install_receipt.json',receipt)
   print(json.dumps(receipt))
  finally:mt5.shutdown();db.close()
if __name__=='__main__':main()
