"""Explicit demo operator close; independent of strategy, news, and ATR entry gates."""
import json,math,time,uuid,hashlib
from pathlib import Path
from emergency_state import read,update
from goldtrap_arc.config import ArcSafetyError
from goldtrap_arc.mt5_adapter import MT5ArcAdapter,ArcConnectionWait
from goldtrap_arc.persistence import ArcLedger,ArcStateStore,atomic_json

class EmergencyAdapter(MT5ArcAdapter):
 def guard_book(self,cycle_id=None,*,fresh=False):
  # The reduction lane may contain several locally proved engine cycles.
  # Account identity, symbol, namespace, fresh quote and global lock still apply.
  snap=super().guard_book(None,fresh=fresh)
  if any(self.cycle(x) not in self.known_cycles for x in snap.positions+snap.orders):
   raise ArcSafetyError('EMERGENCY_UNOWNED_CYCLE')
  for item in snap.positions+snap.orders:
   rows=self.cycle_catalog[self.cycle(item)][1].rows
   if not any(r.get('event')=='BROKER_REQUEST_INTENT' and r.get('operation') in ('TRAP_PENDING','FIXED_PENDING','ADAPTIVE_MARKET')
              and r.get('expected_comment')==item.comment and 0<item.volume<=float(r.get('expected_volume',0))+1e-9 for r in rows):
    raise ArcSafetyError('EMERGENCY_OWNERSHIP_NOT_PROVEN')
  return snap
 def authorization_guard(self,operation):
  if operation not in ('CANCEL','CLOSE'):raise ArcSafetyError('EMERGENCY_REDUCTION_ONLY')
  if time.time()*1000>=self.expires_ms:raise ArcSafetyError('EMERGENCY_AUTHORIZATION_EXPIRED')
 def _write(self,request,**kwargs):
  if kwargs.get('operation') not in ('CANCEL','CLOSE'):raise ArcSafetyError('EMERGENCY_REDUCTION_ONLY')
  if time.time()*1000>=self.expires_ms:raise ArcSafetyError('EMERGENCY_AUTHORIZATION_EXPIRED')
  self.entry_admission_guard=self.authorization_guard
  return super()._write(request,**kwargs)

def catalog(root):
 result={}
 for path in (Path(root)/'logs/arc_v1').rglob('arc_state.json'):
  state=ArcStateStore(path.parent).load();cid=state.get('cycle_id')
  if not cid:continue
  if cid in result:raise ValueError('EMERGENCY_DUPLICATE_CYCLE')
  ledger=ArcLedger(path.parent) # Verify the original chain without appending.
  result[cid]=(path.parent,ledger,state)
 return result

def history_proof(adapter,cid,required_positions=()):
 life=adapter.cycle_lifecycle(cid);entries=life['entry_deals'];exits=life['exit_deals']
 if any(getattr(d,'symbol',None)!=adapter.cfg.symbol or not math.isfinite(float(d.volume)) or float(d.volume)<=0 for d in (*entries,*exits)):
  raise ValueError('EMERGENCY_HISTORY_INVALID')
 if not set(required_positions).issubset({int(d.position_id) for d in entries}):raise ValueError('EMERGENCY_HISTORY_INCOMPLETE')
 if entries:
  ids={int(d.position_id) for d in entries}
  if any(not str(d.comment).startswith('GT_ARC_V1:'+cid+':') or d.magic!=adapter.cfg.magic for d in entries):
   raise ValueError('EMERGENCY_HISTORY_OWNERSHIP')
  for pid in ids:
   en=sum(float(d.volume) for d in entries if d.position_id==pid);ex=sum(float(d.volume) for d in exits if d.position_id==pid)
   if en<=0 or not math.isclose(en,ex,rel_tol=0,abs_tol=1e-9):raise ValueError('EMERGENCY_HISTORY_INCOMPLETE')
  if life['all_closed'] is not True:raise ValueError('EMERGENCY_HISTORY_INCOMPLETE')
 net=float(life['net_pl'])
 if not math.isfinite(net):raise ValueError('EMERGENCY_HISTORY_INVALID')
 return dict(cycle_id=cid,net_usd=net,positions_closed=len({d.position_id for d in entries}),
  history_tickets=sorted(int(d.ticket) for d in (*entries,*exits)))

def reduce_owned(adapter,cycles,ledger,expires_ms,on_progress,clock=time.time,sleep=time.sleep):
 """Only CANCEL/CLOSE. Every action uses the adapter's durable receipt proof."""
 touched={};flat_reads=0
 # Include previously interrupted emergency requests; reconcile before retry.
 for intent in list(ledger.unresolved_requests()):
  adapter._reconcile_intent(intent)
 if ledger.unresolved_requests():raise ValueError('EMERGENCY_UNRESOLVED_REQUEST')
 while clock()*1000<expires_ms:
  try:
   adapter.guard_identity();snap=adapter.guard_book(fresh=False)
   positions,orders=snap.positions,snap.orders
   for item in positions+orders:touched.setdefault(adapter.cycle(item),set())
   for item in positions:touched[adapter.cycle(item)].add(item.ticket)
   if any(cid not in cycles for cid in touched):raise ValueError('EMERGENCY_UNOWNED_CYCLE')
   if not positions and not orders:
    flat_reads+=1;on_progress('VERIFYING_FLAT',0,0)
    if flat_reads>=2:return touched
    sleep(.2);continue
   flat_reads=0
   if orders:
    on_progress('CANCELLING_PENDING',len(positions),len(orders))
    for item in orders:
     if clock()*1000>=expires_ms:raise ValueError('EMERGENCY_AUTHORIZATION_EXPIRED')
     adapter.cancel(item)
   # Cancellation can race a fill. Always refresh the close set.
   snap=adapter.guard_book(fresh=False)
   for item in snap.positions+snap.orders:touched.setdefault(adapter.cycle(item),set())
   for item in snap.positions:touched[adapter.cycle(item)].add(item.ticket)
   on_progress('CLOSING_POSITIONS',len(snap.positions),len(snap.orders))
   for item in snap.positions:
    if clock()*1000>=expires_ms:raise ValueError('EMERGENCY_AUTHORIZATION_EXPIRED')
    adapter.close(item,'OPERATOR_EMERGENCY_CLOSE')
  except ArcConnectionWait:
   on_progress('CONNECTION_UNAVAILABLE',None,None);sleep(.5)
 # Unknown outcomes deliberately propagate; there is no automatic resend.
 raise ValueError('EMERGENCY_AUTHORIZATION_EXPIRED')

def project_closed_batch(root,prior_run,proofs):
 if not prior_run:return
 from v51_batch_telemetry import report,publish
 folder=Path(root)/'logs/arc_v1'/('v51_dashboard_'+str(uuid.UUID(prior_run)).replace('-',''))
 manifest_path=folder/'batch_manifest.json'
 if not manifest_path.exists():return # Request stopped before a cycle was reserved.
 m=json.loads(manifest_path.read_text());slots=m.get('slots',[])
 for slot in slots:
  cid=slot.get('cycle_id')
  if not cid:continue
  result=slot.get('result') or {}
  if result.get('broker_flat_confirmed') is True:continue
  if cid not in proofs:raise ValueError('EMERGENCY_BATCH_HISTORY_MISSING')
  result.update(realized_pl_usd=proofs[cid]['net_usd'],broker_flat_confirmed=True,
   outcome='COMPLETE_EMERGENCY_CLOSE',layers=max(result.get('layers',0),proofs[cid]['positions_closed']))
  slot['result']=result
 payload=report(folder.name,'STOPPED',slots,['OPERATOR_EMERGENCY_CLOSE'])
 payload['requested']=m['max_cycles'];publish(payload)

def execute(root,request_id,expires_ms,prior_run,verify_source):
 import MetaTrader5 as mt5
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 root=Path(root);rid=str(uuid.UUID(request_id));intent=read(root)
 if intent is None or intent['requestId']!=rid or intent['expiresMs']!=expires_ms:
  raise ValueError('EMERGENCY_INTENT_MISMATCH')
 verify_source()
 # Do not steal the lock or kill a runner. Unresponsive owner remains visible.
 lock=ArcRunnerLock(lock_key=LOCK_KEY)
 try:lock.__enter__()
 except ArcSafetyError:raise ValueError('EMERGENCY_WAITING_ENGINE') from None
 try:
  adapter=EmergencyAdapter(mt5,allow_execution=True);adapter.broker_lock=lock;adapter.expires_ms=expires_ms
  directory=root/'read_only/emergency_journal';ledger=ArcLedger(directory);ledger.initialize()
  adapter.bind_persistence(ledger,ArcStateStore(directory))
  adapter.initialize();adapter.guard_identity();cycles=catalog(root);adapter.known_cycles=set(cycles);adapter.cycle_catalog=cycles
  ledger.append('EMERGENCY_CLOSE_AUTHORIZED',request_id=rid,expires_ms=expires_ms,prior_run=prior_run)
  touched=reduce_owned(adapter,cycles,ledger,expires_ms,lambda *args:update(root,*args))
  # Verify the interrupted run even if broker TP closed it before the click.
  if prior_run:
   folder=root/'logs/arc_v1'/('v51_dashboard_'+str(uuid.UUID(prior_run)).replace('-',''))
   manifest=folder/'batch_manifest.json'
   if manifest.exists():
    for slot in json.loads(manifest.read_text()).get('slots',[]):
     if slot.get('cycle_id'):touched.setdefault(slot['cycle_id'],set())
  # Also validate original request evidence. Flat alone never erases ambiguity.
  proofs={}
  for cid in touched:
   if cid not in cycles:raise ValueError('EMERGENCY_UNOWNED_CYCLE')
   if cycles[cid][1].unresolved_requests():raise ValueError('EMERGENCY_PRIOR_REQUEST_UNRESOLVED')
   required=touched[cid]|set(cycles[cid][2].get('last_live_position_tickets',[]))
   proofs[cid]=history_proof(adapter,cid,required)
   proofs[cid].update(state_sha256=hashlib.sha256((cycles[cid][0]/'arc_state.json').read_bytes()).hexdigest(),ledger_tail=cycles[cid][1].tail)
  if ledger.unresolved_requests():raise ValueError('EMERGENCY_UNRESOLVED_REQUEST')
  final=adapter.guard_book(fresh=False)
  if final.positions or final.orders:raise ValueError('EMERGENCY_FLAT_UNCONFIRMED')
  for cid in touched:
   again=history_proof(adapter,cid)
   if any(proofs[cid].get(k)!=v for k,v in again.items()):raise ValueError('EMERGENCY_HISTORY_CHANGED')
   if ArcLedger(cycles[cid][0]).tail!=proofs[cid]['ledger_tail'] or hashlib.sha256((cycles[cid][0]/'arc_state.json').read_bytes()).hexdigest()!=proofs[cid]['state_sha256']:raise ValueError('EMERGENCY_JOURNAL_CHANGED')
  result=dict(request_id=rid,broker_flat=True,cycles=proofs,observed_ms=int(time.time()*1000),new_cycle_started=False)
  verify_source()
  atomic_json(root/'read_only'/('emergency_proof_'+rid+'.json'),result)
  project_closed_batch(root,prior_run,proofs)
  ledger.append('EMERGENCY_CLOSE_COMPLETE',request_id=rid,broker_flat=True)
  update(root,'COMPLETE',0,0)
  return result
 finally:
  try:mt5.shutdown()
  finally:lock.__exit__(None,None,None)

def cancelled_only_proof(root,state_path,ledger,life):
 """Bind an unfilled cancelled cycle to a completed emergency and intact history."""
 if life.get('entry_deals') or life.get('exit_deals') or ledger.unresolved_requests():return False
 state=ArcStateStore(state_path.parent).load()
 if state.get('last_live_position_tickets'):return False
 directory=Path(root)/'read_only'
 if not (directory/'emergency_journal').exists():return False
 journal=ArcLedger(directory/'emergency_journal')
 completed={r.get('request_id') for r in journal.rows if r.get('event')=='EMERGENCY_CLOSE_COMPLETE' and r.get('broker_flat') is True}
 for rid in completed:
  try:
   rid=str(uuid.UUID(rid));proof=json.loads((directory/('emergency_proof_'+rid+'.json')).read_text())
   row=proof['cycles'].get(state['cycle_id'])
   if not row:continue
   if (proof['request_id']==rid and proof['broker_flat'] is True and proof['new_cycle_started'] is False
       and row['positions_closed']==0 and not row['history_tickets'] and row['net_usd']==0
       and row['state_sha256']==hashlib.sha256(state_path.read_bytes()).hexdigest() and row['ledger_tail']==ledger.tail):return True
  except (OSError,ValueError,KeyError,TypeError):continue
 return False
