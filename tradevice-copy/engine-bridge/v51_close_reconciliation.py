"""Read-only broker reconciliation after a completed account Close all.
No entry, cancellation or close dispatch; original trading journals stay immutable.
"""
import hashlib,json,os,time,uuid
from pathlib import Path
from goldtrap_arc.persistence import ArcLedger

def matches_cancel_proof(state_path,ledger,proofs):
 state=json.loads(state_path.read_text());proof=proofs.get(state.get('cycle_id'),{})
 return (proof.get('request_ids')==sorted(i['request_id'] for i in ledger.unresolved_requests())
  and proof.get('state_sha256')==hashlib.sha256(state_path.read_bytes()).hexdigest() and proof.get('ledger_tail')==ledger.tail)

def stored_cancel_proof(root,state_path,ledger):
 directory=Path(root)/'read_only';journal=directory/'close_reconciliation_journal'
 if not journal.exists():return False
 for row in ArcLedger(journal).rows:
  if row.get('event')!='CLOSE_RECONCILIATION_COMPLETE':continue
  digest=row.get('proof_sha256','')
  if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):continue
  try:
   raw=(directory/('close_reconciliation_'+digest+'.json')).read_bytes()
   if hashlib.sha256(raw).hexdigest()!=digest:continue
   proof=json.loads(raw)
   if (proof.get('close_request_id')==row.get('close_request_id') and proof.get('broker_flat') is True
       and proof.get('orders_sent')==0 and matches_cancel_proof(state_path,ledger,proof.get('prior_cancel_proofs',{}))):return True
  except (OSError,ValueError,KeyError,TypeError):continue
 return False

def prove_closed_run(root,prior_run,close_id,adapter,verify_source,reconcile_prior):
 from emergency_state import read
 from v51_account_close import original_cancel_proofs
 root=Path(root);prior_run=str(uuid.UUID(prior_run));close_id=str(uuid.UUID(close_id));verify_source()
 latch=read(root)
 if not latch or latch['requestId']!=close_id or latch['phase']!='COMPLETE':raise ValueError('CLOSE_RECONCILIATION_NOT_COMPLETE')
 prior=json.loads((root/'read_only'/('account_reduction_proof_'+close_id+'.json')).read_text())
 if (prior.get('request_id')!=close_id or prior.get('scope')!='ALL_DEMO_ACCOUNT' or prior.get('broker_flat') is not True
     or prior.get('positions_remaining')!=0 or prior.get('orders_remaining')!=0 or prior.get('new_cycle_started') is not False):raise ValueError('CLOSE_RECONCILIATION_PROOF_INVALID')
 journal=ArcLedger(root/'read_only/account_reduction_journal')
 if not any(r.get('event')=='ACCOUNT_REDUCTION_COMPLETE' and r.get('request_id')==close_id and r.get('broker_flat') is True for r in journal.rows):raise ValueError('CLOSE_RECONCILIATION_RECEIPT_MISSING')
 intents={r['operation_id'] for r in journal.rows if r.get('event')=='ACCOUNT_REDUCTION_INTENT'}
 resolved={r['operation_id'] for r in journal.rows if r.get('event')=='ACCOUNT_REDUCTION_RESOLVED'}
 if intents-resolved:raise ValueError('CLOSE_RECONCILIATION_ACCOUNT_UNSETTLED')
 def hashes():return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'logs/arc_v1').rglob('*') if p.is_file() and p.suffix in ('.json','.jsonl')}
 before=hashes()
 folder=root/'logs/arc_v1'/('v51_dashboard_'+prior_run.replace('-',''))
 manifest=json.loads((folder/'batch_manifest.json').read_text())
 if manifest.get('status') not in ('SAFETY_STOP','STOPPED','BLOCKED') and not str(manifest.get('status','')).startswith('STOPPED_'):raise ValueError('CLOSE_RECONCILIATION_BATCH_NOT_TERMINAL')
 if ArcLedger(folder).unresolved_requests():raise ValueError('CLOSE_RECONCILIATION_BATCH_UNSETTLED')
 def flat():
  adapter.guard_identity();p,o=adapter.mt5.positions_get(),adapter.mt5.orders_get()
  if p is None or o is None or p or o:raise ValueError('CLOSE_RECONCILIATION_BROKER_NOT_FLAT')
 flat();proofs=original_cancel_proofs(root,adapter)
 reconcile_prior(adapter,write=False,cancel_proofs=proofs)
 for slot in manifest.get('slots',[]):
  if slot.get('cycle_id') and slot.get('result',{}).get('broker_flat_confirmed') is not True and slot['cycle_id'] not in proofs:raise ValueError('CLOSE_RECONCILIATION_HISTORY_MISSING')
 flat()
 if original_cancel_proofs(root,adapter)!=proofs or hashes()!=before or read(root)!=latch:raise ValueError('CLOSE_RECONCILIATION_EVIDENCE_CHANGED')
 verify_source();flat()
 return dict(prior_run=prior_run,close_request_id=close_id,broker_flat=True,orders_sent=0,new_cycle_started=False,
  original_journals_modified=False,observed_ms=int(time.time()*1000),files=before,prior_cancel_proofs=proofs)

def reconcile_closed_run(root,prior_run,close_id,verify_source,reconcile_prior):
 import MetaTrader5 as mt5
 from goldtrap_arc.mt5_adapter import MT5ArcAdapter
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 from v51_emergency_close import project_closed_batch
 root=Path(root)
 with ArcRunnerLock(lock_key=LOCK_KEY):
  adapter=MT5ArcAdapter(mt5,allow_execution=False)
  try:
   adapter.initialize()
   proof=prove_closed_run(root,prior_run,close_id,adapter,verify_source,reconcile_prior)
   raw=(json.dumps(proof,sort_keys=True,indent=2)+'\n').encode();digest=hashlib.sha256(raw).hexdigest()
   path=root/'read_only'/('close_reconciliation_'+digest+'.json');temp=path.with_suffix('.tmp')
   with temp.open('wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
   os.replace(temp,path)
   audit=ArcLedger(root/'read_only/close_reconciliation_journal');audit.initialize()
   audit.append('CLOSE_RECONCILIATION_COMPLETE',close_request_id=close_id,prior_run=prior_run,proof_sha256=digest)
   project_closed_batch(root,prior_run,{cid:p['history'] for cid,p in proof['prior_cancel_proofs'].items()})
   return proof
  finally:mt5.shutdown()
