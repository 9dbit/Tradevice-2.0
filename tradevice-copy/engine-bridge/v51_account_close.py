"""Explicit account-wide DEMO reduction. Never constructs an entry request.

The caller owns the ARC OS lock, durable entry latch and a 60-second command.
Every dispatch records intent first. Unknown receipts never trigger a resend.
The original engine journals remain immutable, even after account-flat proof.
"""
import json,math,time,uuid
from pathlib import Path
from goldtrap_arc.persistence import ArcLedger,atomic_json
from goldtrap_arc.mt5_adapter import ArcConnectionWait

class AccountReducer:
 def __init__(self,api,identity,ledger,expires_ms,clock=time.time,sleep=time.sleep):
  self.cancel_owned_only=False;self.api=api;self.identity=identity;self.ledger=ledger;self.expires_ms=expires_ms;self.clock=clock;self.sleep=sleep
 def guard(self):
  if self.clock()*1000>=self.expires_ms:raise ValueError('EMERGENCY_AUTHORIZATION_EXPIRED')
  self.identity()
 def book(self):
  self.guard();p=self.api.positions_get();o=self.api.orders_get()
  if p is None or o is None:raise ArcConnectionWait('Account book unavailable')
  return list(p),[x for x in o if not self.cancel_owned_only or (x.symbol=='XAUUSDm' and x.magic==8802001 and str(x.comment).startswith('GT_ARC_V1:'))]
 def closed(self,pid,symbol):
  self.guard();deals=self.api.history_deals_get(position=pid)
  if deals is None:raise ArcConnectionWait('Position history unavailable')
  trades=[d for d in deals if d.type in (0,1)]
  if not trades or any(d.symbol!=symbol or d.entry not in (0,1,3) or not math.isfinite(d.volume) or d.volume<=0 for d in trades):return False
  opened=sum(d.volume for d in trades if d.entry==0);closed=sum(d.volume for d in trades if d.entry in (1,3))
  return opened>0 and math.isclose(opened,closed,rel_tol=0,abs_tol=1e-9)
 def effect(self,intent):
  p,o=self.book();ticket=intent['ticket'];op=intent['operation']
  if op=='CANCEL':
   if any(x.ticket==ticket for x in o):return False
   history=self.api.history_orders_get(ticket=ticket)
   # Disappearance alone is not cancellation proof. Filled orders are retired
   # too; the caller refreshes positions before closing them.
   return bool(history) and any(x.ticket==ticket and x.symbol==intent['symbol'] and x.state in (2,4,5,6) for x in history)
  if any(x.ticket==ticket for x in p):return False
  return self.closed(intent['position_id'],intent['symbol'])
 def reconcile(self):
  rows=self.ledger.rows
  resolved={r['operation_id'] for r in rows if r['event']=='ACCOUNT_REDUCTION_RESOLVED'}
  for i in [r for r in rows if r['event']=='ACCOUNT_REDUCTION_INTENT' and r['operation_id'] not in resolved]:
   if not self.effect(i):raise ValueError('EMERGENCY_PRIOR_REQUEST_UNCONFIRMED')
   self.ledger.append('ACCOUNT_REDUCTION_RESOLVED',operation_id=i['operation_id'],proof='BROKER_TERMINAL_HISTORY')
 def dispatch(self,item,operation):
  self.guard();p,o=self.book();current=next((x for x in (o if operation=='CANCEL' else p) if x.ticket==item.ticket),None)
  if current is None:return
  if (current.symbol,current.type)!=(item.symbol,item.type):raise ValueError('EMERGENCY_TICKET_CHANGED')
  item=current
  req=dict(action=self.api.TRADE_ACTION_REMOVE,order=item.ticket) if operation=='CANCEL' else self.close_request(item)
  self.guard();check=self.api.order_check(req)
  if check is None:raise ArcConnectionWait('Account reduction check unavailable')
  if check.retcode not in (0,10009):
   if check.retcode in (10029,10020,10021):self.sleep(.25);return
   raise ValueError('EMERGENCY_CHECK_REJECTED')
  self.guard()
  oid=uuid.uuid4().hex
  intent=dict(operation_id=oid,operation=operation,ticket=int(item.ticket),position_id=int(getattr(item,'identifier',item.ticket)),symbol=item.symbol,request=req)
  self.ledger.append('ACCOUNT_REDUCTION_INTENT',**intent)
  try:self.guard()
  except Exception:
   self.ledger.append('ACCOUNT_REDUCTION_RESOLVED',operation_id=oid,proof='NOT_DISPATCHED_GUARD');raise
  try:
   result=self.api.order_send(req)
  except Exception:
   self.ledger.append('ACCOUNT_REDUCTION_RECEIPT',operation_id=oid,retcode=None)
   if not self.effect(intent):raise ValueError('EMERGENCY_REQUEST_UNCONFIRMED') from None
   result=None
  code=getattr(result,'retcode',None)
  self.ledger.append('ACCOUNT_REDUCTION_RECEIPT',operation_id=oid,retcode=code)
  for _ in range(20):
   if self.effect(intent):
    self.ledger.append('ACCOUNT_REDUCTION_RESOLVED',operation_id=oid,proof='BROKER_TERMINAL_HISTORY');return
   self.sleep(.1)
  # Explicit no-effect reject permits a fresh, revalidated request later. Missing
  # response/timeouts, accepted-but-unseen and partial fills never get replayed.
  p,o=self.book();live=next((x for x in (o if operation=='CANCEL' else p) if x.ticket==item.ticket),None)
  unchanged=live is not None and live.symbol==item.symbol and live.type==item.type and (operation=='CANCEL' or math.isclose(live.volume,item.volume,abs_tol=1e-9))
  if code in (10029,10020,10021) and unchanged:
   self.ledger.append('ACCOUNT_REDUCTION_RESOLVED',operation_id=oid,proof='EXPLICIT_REJECT_TARGET_STILL_LIVE');self.sleep(.25);return
  raise ValueError('EMERGENCY_REQUEST_UNCONFIRMED')
 def close_request(self,p):
  self.guard();si=self.api.symbol_info(p.symbol);tick=self.api.symbol_info_tick(p.symbol)
  if si is None or tick is None or not 0<=self.clock()*1000-tick.time_msc<=5000:raise ArcConnectionWait('Close quote unavailable')
  if p.type not in (0,1) or not math.isfinite(p.volume) or p.volume<=0:raise ValueError('EMERGENCY_POSITION_INVALID')
  price=tick.bid if p.type==0 else tick.ask
  if not math.isfinite(price) or price<=0:raise ValueError('EMERGENCY_QUOTE_INVALID')
  flags=int(si.filling_mode)
  filling=0 if flags&1 else 1 if flags&2 else 2 if si.trade_exemode!=2 else None
  if filling is None:raise ValueError('EMERGENCY_FILL_POLICY_UNAVAILABLE')
  return dict(action=self.api.TRADE_ACTION_DEAL,position=int(p.ticket),symbol=p.symbol,volume=float(p.volume),type=1 if p.type==0 else 0,price=float(price),deviation=30,type_filling=filling,comment='TRADEVICE_CLOSE_ALL')
 def reduce(self,close_positions,progress):
  self.cancel_owned_only=not close_positions;self.reconcile();flat=0;touched={}
  while self.clock()*1000<self.expires_ms:
   try:
    # A connection gap after dispatch must reconcile the durable intent before
    # another request can be constructed, even within the same process.
    self.reconcile()
    p,o=self.book()
    for x in p:touched[int(getattr(x,'identifier',x.ticket))]=x.symbol
    if not o and (not close_positions or not p):
     flat+=1;progress('VERIFYING_FLAT' if close_positions else 'PENDING_RETIRED',len(p),len(o))
     if flat>=2:
      if close_positions and not all(self.closed(pid,sym) for pid,sym in touched.items()):raise ValueError('EMERGENCY_HISTORY_INCOMPLETE')
      return dict(broker_flat=not p,pending_retired=True,positions_remaining=len(p),orders_remaining=0,position_ids=sorted(touched))
     self.sleep(.2);continue
    flat=0;progress('CANCELLING_PENDING',len(p),len(o))
    for x in o:self.dispatch(x,'CANCEL')
    if close_positions:
     p,o=self.book();progress('CLOSING_POSITIONS',len(p),len(o))
     for x in p:
      touched[int(getattr(x,'identifier',x.ticket))]=x.symbol;self.dispatch(x,'CLOSE')
   except ArcConnectionWait:
    progress('CONNECTION_UNAVAILABLE',None,None);self.sleep(.5)
  raise ValueError('EMERGENCY_AUTHORIZATION_EXPIRED')

def execute(root,request_id,expires_ms,verify_source,*,close_positions=True):
 import MetaTrader5 as mt5
 from goldtrap_arc.mt5_adapter import MT5ArcAdapter
 from v51_batch_core import ArcRunnerLock,LOCK_KEY
 from emergency_state import read,update,requested
 root=Path(root);rid=str(uuid.UUID(request_id));verify_source()
 if close_positions:
  intent=read(root)
  if not intent or intent['requestId']!=rid or intent['expiresMs']!=expires_ms:raise ValueError('EMERGENCY_INTENT_MISMATCH')
 lock=ArcRunnerLock(lock_key=LOCK_KEY)
 try:lock.__enter__()
 except Exception:raise ValueError('EMERGENCY_WAITING_ENGINE') from None
 try:
  a=MT5ArcAdapter(mt5,allow_execution=False);a.initialize();account,_,_=a.guard_identity()
  if account.margin_mode!=getattr(mt5,'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING',2):raise ValueError('EMERGENCY_HEDGING_ACCOUNT_REQUIRED')
  def identity():
   a.guard_identity()
   if not close_positions and requested(root):raise ValueError('EMERGENCY_SUPERSEDED_CONTROL')
  ledger=ArcLedger(root/'read_only/account_reduction_journal');ledger.initialize()
  ledger.append('ACCOUNT_REDUCTION_AUTHORIZED',request_id=rid,expires_ms=expires_ms,scope='ALL_DEMO_ACCOUNT' if close_positions else 'TRADEVICE_PENDING',close_positions=close_positions)
  progress=(lambda *args:update(root,*args)) if close_positions else (lambda *args:None)
  result=AccountReducer(mt5,identity,ledger,expires_ms).reduce(close_positions,progress)
  if close_positions:
   try:result['prior_cancel_proofs']=original_cancel_proofs(root,a)
   except Exception:result.update(prior_cancel_proofs={},reconciliation_required=True)
  verify_source()
  final_positions,final_orders=mt5.positions_get(),mt5.orders_get()
  if close_positions and (final_positions is None or final_orders is None or final_positions or final_orders):raise ValueError('EMERGENCY_FLAT_UNCONFIRMED')
  result.update(request_id=rid,scope='ALL_DEMO_ACCOUNT' if close_positions else 'TRADEVICE_PENDING',observed_ms=int(time.time()*1000),new_cycle_started=False)
  atomic_json(root/'read_only'/('account_reduction_proof_'+rid+'.json'),result)
  ledger.append('ACCOUNT_REDUCTION_COMPLETE',**result)
  if close_positions:update(root,'COMPLETE',0,0)
  return result
 finally:
  try:mt5.shutdown()
  finally:lock.__exit__(None,None,None)

def original_cancel_proofs(root,adapter):
 """Read-only proof for rejected cancellations overtaken by broker fills.
 A terminal historical order is not described as a successful cancel. Only the
 exact frozen-reject case qualifies; other unresolved requests remain blocked.
 """
 import hashlib
 from v51_emergency_close import catalog,history_proof
 proofs={}
 for cid,(directory,ledger,state) in catalog(root).items():
  unresolved=ledger.unresolved_requests()
  if not unresolved and str(state.get('state','')).startswith('COMPLETE'):continue
  valid=True
  for intent in unresolved:
   receipts=ledger.receipts(intent['request_id'])
   if (intent.get('operation')!='CANCEL' or not receipts or
       any(r.get('classification')!='DEFINITIVE_REJECT' or r.get('retcode')!=10029 for r in receipts)):
    valid=False;break
   history=adapter.mt5.history_orders_get(ticket=intent['target_ticket'])
   if not history or len(history)!=1:
    valid=False;break
   order=history[0]
   if (order.ticket!=intent['target_ticket'] or order.symbol!=adapter.cfg.symbol or order.magic!=adapter.cfg.magic
       or order.comment!=intent['expected_comment'] or order.state not in (2,4,5,6)
       or not math.isclose(order.volume_initial,float(intent['expected_volume']),abs_tol=1e-9)):
    valid=False;break
  if not valid:continue
  try:life=history_proof(adapter,cid)
  except (ValueError,KeyError):continue
  if not life['positions_closed']:
   for intent in [r for r in ledger.rows if r.get('event')=='BROKER_REQUEST_INTENT' and r.get('operation') in ('TRAP_PENDING','FIXED_PENDING')]:
    for receipt in ledger.receipts(intent['request_id']):
     if receipt.get('classification')!='ACCEPTED':continue
     ticket=(receipt.get('raw_result') or {}).get('order')
     orders=adapter.mt5.history_orders_get(ticket=ticket) if ticket else None
     if not orders or not any(o.ticket==ticket and o.comment==intent['expected_comment'] and o.magic==adapter.cfg.magic and o.symbol==adapter.cfg.symbol and o.state in (2,5,6) for o in orders):valid=False
   if not valid:continue
  proofs[cid]=dict(request_ids=sorted(i['request_id'] for i in unresolved),state_sha256=hashlib.sha256((directory/'arc_state.json').read_bytes()).hexdigest(),ledger_tail=ledger.tail,history=life)
 return proofs

def proves_cancel_reconciliation(root,state_path,ledger):
 import hashlib
 state=json.loads(state_path.read_text());cid=state.get('cycle_id');ids=sorted(i['request_id'] for i in ledger.unresolved_requests())
 journal_path=Path(root)/'read_only/account_reduction_journal'
 if not journal_path.exists():return False
 journal=ArcLedger(journal_path)
 completed={r['request_id'] for r in journal.rows if r['event']=='ACCOUNT_REDUCTION_COMPLETE' and r.get('broker_flat') is True}
 for rid in completed:
  try:
   p=json.loads((Path(root)/'read_only'/('account_reduction_proof_'+str(uuid.UUID(rid))+'.json')).read_text())
   proof=p.get('prior_cancel_proofs',{}).get(cid,{})
   if (p.get('broker_flat') is True and p.get('request_id')==rid and proof.get('request_ids')==ids
    and proof.get('state_sha256')==hashlib.sha256(state_path.read_bytes()).hexdigest() and proof.get('ledger_tail')==ledger.tail):return True
  except (OSError,ValueError,KeyError,TypeError):continue
 return False
