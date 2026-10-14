"""Install reviewed bridge files into the isolated clone; never starts a process/order.
Run using the clone's Python. Private engine sources/journals never leave TRADEVICEPC.
"""
import hashlib,json,shutil
from pathlib import Path

def install(root,previous_fingerprint=None):
 root=Path(root).resolve()
 if root.name!='GoldTrapCore_v0.2_v51_research_20261013':raise ValueError('ISOLATED_CLONE_REQUIRED')
 p=root/'v51_batch_core.py';source=p.read_text(encoding='utf-8')
 marker='cycle_limit=LIMIT, stop_requested=None'
 if marker not in source:
  changes=[
   ("or m.get('max_cycles') != LIMIT", "or type(m.get('max_cycles')) is not int or not 1<=m['max_cycles']<=LIMIT"),
   ("len(slots) > LIMIT", "len(slots) > m['max_cycles']"),
   ("len(m['slots']) >= LIMIT", "len(m['slots']) >= m['max_cycles']"),
   ("continuation_parent=None, refresh_recovery=None):", "continuation_parent=None, refresh_recovery=None, cycle_limit=LIMIT, stop_requested=None):"),
   ("    manifest_path = root / 'batch_manifest.json'", "    if type(cycle_limit) is not int or not 1<=cycle_limit<=LIMIT:raise ArcSafetyError('BOUNDED_CYCLE_LIMIT_REQUIRED')\n    if continuation_parent is not None and cycle_limit!=LIMIT:raise ArcSafetyError('CONTINUATION_LIMIT_CHANGED')\n    manifest_path = root / 'batch_manifest.json'"),
   ("max_cycles=LIMIT,", "max_cycles=cycle_limit,"),
   ("maximum=LIMIT)", "maximum=m['max_cycles'])"),
   ("                    if len(m['slots']) == LIMIT:", "                    if stop_requested is not None and stop_requested():\n                        m.update(status='STOPPED_OPERATOR',ended_at=utc(),no_new_cycle=True)\n                        break\n                    if len(m['slots']) == m['max_cycles']:"),
   ("len(m['slots'])<LIMIT", "len(m['slots'])<m['max_cycles']"),
  ]
  updated=source
  for old,new in changes:
   if updated.count(old)!=1:raise ValueError('CORE_PATCH_CONTEXT_CHANGED')
   updated=updated.replace(old,new)
  compile(updated,str(p),'exec')
  backup=root/'v51_batch_core.before_dashboard_bridge.py'
  if backup.exists():raise ValueError('BACKUP_ALREADY_EXISTS_REVIEW_REQUIRED')
  shutil.copyfile(p,backup);p.write_text(updated,encoding='utf-8')
 source=p.read_text(encoding='utf-8')
 if 'prior_reconciliation=None' not in source:
  changes=[
   ('cycle_limit=LIMIT, stop_requested=None):','cycle_limit=LIMIT, stop_requested=None, prior_reconciliation=None):'),
   ("            proved_paths=set(continuation['files_sha256']) if continuation else set()","            proved_paths=set(continuation['files_sha256']) if continuation else set()\n            if prior_reconciliation is not None:proved_paths.update(prior_reconciliation(adapter))")]
  updated=source
  for old,new in changes:
   if updated.count(old)!=1:raise ValueError('RECONCILIATION_PATCH_CONTEXT_CHANGED')
   updated=updated.replace(old,new)
  compile(updated,str(p),'exec')
  backup=root/'v51_batch_core.before_dashboard_reconciliation.py'
  if backup.exists():raise ValueError('RECONCILIATION_BACKUP_EXISTS')
  shutil.copyfile(p,backup);p.write_text(updated,encoding='utf-8')
 files=list((root/'goldtrap_arc').glob('*.py'))+[root/name for name in (
  'v51_batch_core.py','v51_batch_research.py','v51_demo_batch_runtime.py','v51_batch_telemetry.py',
  'v51_guarded_engine.py','v51_observed_engine.py','v51_engine_diagnostics.py','v51_runtime_calendar.py',
  'v51_forexfactory_calendar.py','v51_news_guard.py','v51_dashboard_runtime.py','bridge.py','arc_spec.json')]
 manifest=dict(skillHash='bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee',
  files={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
 target=root/'read_only'/'demo_engine_fingerprint.json'
 if target.exists():
  if json.loads(target.read_text())!=manifest:
   digest=hashlib.sha256(target.read_bytes()).hexdigest()
   if previous_fingerprint!=digest:raise ValueError('EXISTING_FINGERPRINT_REVIEW_REQUIRED')
   shutil.copyfile(target,target.with_name('demo_engine_fingerprint.'+digest[:12]+'.json'))
   target.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 else:target.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 print(json.dumps({'installed':True,'fingerprinted_files':len(files),'orders_sent':0,'started':False}))
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--previous-fingerprint');a=p.parse_args()
 install(Path(__file__).resolve().parent,a.previous_fingerprint)
