"""One authorized finite demo test; startup never resumes or adopts a cycle."""
import argparse,hashlib,json,time
from pathlib import Path
from v51_batch_core import run,ArcSafetyError
from v51_batch_research import ResearchBatchAdapter,margin_envelope
from v51_guarded_engine import NewsGuardedArcExecutionEngine
from v51_runtime_calendar import RuntimeCalendar
from v51_batch_telemetry import report,publish,stop_blockers
from goldtrap_arc.persistence import ArcLedger,atomic_json
ROOT=Path(__file__).resolve().parent
STATUS=ROOT/'read_only'/'observer_connection_status.json'

class Session:
 def __init__(self,batch_id,clock=time.time):
  self.batch_id=batch_id;self.clock=clock;self.deadline=clock()+3600
  self.calendar=RuntimeCalendar();self.last_emit=0;self.write_failed=False
  self.manifest=None;self.last_engine=None;self.prior_verified=False
 def status(self):
  try:
   if STATUS.stat().st_size>4096:return {}
   value=json.loads(STATUS.read_text())
   return value if isinstance(value,dict) else {}
  except (OSError,ValueError):return {}
 def acknowledged(self,completed=0):
  s=self.status()
  if not isinstance(s,dict):return False
  ack=s.get('demo_batch_ack') or {};now=int(self.clock()*1000)
  if not isinstance(ack,dict):return False
  return (s.get('status')=='ACCEPTED_READ_ONLY' and type(s.get('last_accepted_utc_ms')) is int
   and 0<=now-s['last_accepted_utc_ms']<=15000 and ack.get('batch_id')==self.batch_id
   and type(ack.get('completed')) is int and ack['completed']>=completed)
 def decision(self,*,active_cycle=False):
  news=self.calendar.decision()
  if news.get('status')!='CLEAR':return news
  reason=None
  if not active_cycle:
   if self.clock()>=self.deadline:reason='BATCH_ENTRY_DEADLINE'

   # Telemetry is an admission gate, never a reason to retire an owned ladder.
   # Broker identity, fresh quotes, news and risk exits remain enforced. Deadline blocks new cycles only.
   elif self.write_failed:reason='BATCH_REPORT_WRITE_FAILED'
   elif not self.acknowledged():reason='BATCH_TELEMETRY_STALE'
  if reason:return dict(status='UNKNOWN',reason=reason,entries_allowed=False)
  return news
 def engine(self,*args,**kwargs):
  engine=NewsGuardedArcExecutionEngine(*args,**kwargs)
  # Recheck telemetry before a durable cycle exists, including the gap after
  # admission. Existing durable suspensions are intentionally not cleared.
  engine.news_provider=lambda:self.decision(active_cycle=bool(engine.state.get('cycle_id')))
  return engine
 def emit(self,m,engine=None,force=False):
  self.manifest=m;self.last_engine=engine
  now=self.clock()
  if not force and now-self.last_emit<1:return
  self.last_emit=now
  status=m.get('status','PREFLIGHT');slots=m.get('slots',[])
  completed=sum(bool(s.get('result',{}).get('broker_flat_confirmed')) and s.get('result',{}).get('layers',0)>0 for s in slots)
  mapped=('COMPLETED' if completed==10 else 'STOPPED') if status=='AUTO_STOP_10_CYCLES' else ('STOPPED' if status.startswith('STOPPED_') else status)
  blockers=[]
  if engine and engine.state.get('news_entry_suspended'):blockers=[engine.state.get('news_reason','ENTRY_SUSPENDED')]
  blockers+=stop_blockers(m,engine)
  try:publish(report(self.batch_id,mapped,slots,blockers,int(now*1000)));self.write_failed=False
  except Exception:self.write_failed=True # supervision must survive telemetry IO failure
 def admission(self,adapter):
  if self.manifest:self.emit(self.manifest,self.last_engine,force=True)
  completed=sum(s.get('result',{}).get('broker_flat_confirmed') is True and s.get('result',{}).get('layers',0)>0 for s in (self.manifest or {}).get('slots',[]))
  deadline=self.clock()+30
  while not self.acknowledged(completed) and self.clock()<deadline:
   if self.manifest:self.emit(self.manifest,self.last_engine)
   time.sleep(.25)
  if not self.acknowledged(completed):raise ArcSafetyError('BATCH_TELEMETRY_NOT_ACKNOWLEDGED')
  d=self.decision()
  if d.get('status')!='CLEAR' or not d.get('entries_allowed'):raise ArcSafetyError('BATCH_ENTRY_GATE_'+str(d.get('reason','UNKNOWN')))
  p,o=adapter.mt5.positions_get(),adapter.mt5.orders_get()
  if p is None or o is None or p or o:raise ArcSafetyError('BATCH_PREFLIGHT_NOT_FLAT')
  economics=margin_envelope(adapter)
  deals,_=adapter._raw_history()
  owned=[d for d in deals if getattr(d,'symbol','')=='XAUUSDm' and getattr(d,'magic',0)==adapter.cfg.magic and getattr(d,'type',-1) in (0,1)]
  if not owned or any(getattr(d,'commission',None)!=0 or getattr(d,'fee',None)!=0 for d in owned):raise ArcSafetyError('BATCH_STANDARD_COMMISSION_NOT_CONFIRMED')
  if not self.prior_verified:
   old=ROOT.parent/'GoldTrapCore_v0.2_candidate_reversal_risk_20261010'/'logs'/'arc_v1'/'batch_v5_real_demo_10_20261010_021259'/'cycle_05'
   ledger=ArcLedger(old) # reads and verifies hash chain; no initialize/append/save
   if ledger.unresolved_requests():raise ArcSafetyError('PRIOR_CYCLE_UNRESOLVED_REQUEST')
   state=json.loads((old/'arc_state.json').read_text());life=adapter.cycle_lifecycle(state['cycle_id'])
   if state['cycle_id']!='1908fc85' or not life['all_closed']:raise ArcSafetyError('PRIOR_CYCLE_NOT_RECONCILED')
   proof=dict(observed_ms=int(self.clock()*1000),read_only=True,cycle_id=state['cycle_id'],
    old_state=state['state'],old_ledger_tail=ledger.tail,history_all_closed=True,
    current_account_flat=True,realized_history_net=life['net_pl'],original_journal_modified=False,
    counted_in_new_batch=False,economics=economics)
   atomic_json(ROOT/'read_only'/'demo10_prior_reconciliation_20261014.json',proof)
   self.prior_verified=True
 def wait_calendar_refresh(self):
  # A finite wait never extends the original batch entry deadline.
  remaining=max(0.0,min(320.0,self.deadline-self.clock()))
  def heartbeat():
   if self.manifest:self.emit(self.manifest,self.last_engine)
  return self.calendar.wait_ready(timeout_s=remaining,on_wait=heartbeat)
 def recover_calendar_refresh(self,adapter,engine):
  if engine.state.get('calendar_refresh_only') is not True:return False
  ready=self.wait_calendar_refresh()
  if ready.get('status')!='CLEAR' or ready.get('entries_allowed') is not True:return False
  # Fresh calendar alone is insufficient: telemetry, deadline, flat broker,
  # identity/economics and reconciliation must still pass normal admission.
  self.admission(adapter)
  return True
 def main(self,mt5,batch_dir,*,continuation_parent=None):
  self.emit(dict(status='PREFLIGHT',slots=[]),force=True)
  self.calendar.start()
  try:
   # A preflight fetch can own the five-minute cooldown. Wait for a new verified
   # response; never promote persisted data or cooldown to permission to trade.
   ready=self.calendar.wait_ready(on_wait=lambda:self.emit(dict(status='PREFLIGHT',slots=[])))
   if ready.get('status')!='CLEAR' or not ready.get('entries_allowed'):
    raise ArcSafetyError('BATCH_ENTRY_GATE_'+str(ready.get('reason','UNKNOWN')))
   return run(batch_dir,False,mt5,fixed_arming='PREARM_BOTH',engine_class=self.engine,
    adapter_class=ResearchBatchAdapter,admission=self.admission,reporter=self.emit,
    continuation_parent=continuation_parent,refresh_recovery=self.recover_calendar_refresh)
  except BaseException as exc:
   if not batch_dir.exists():
    reason=str(exc)
    if not reason or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_' for c in reason):reason='PREFLIGHT_FAILED'
    publish(report(self.batch_id,'BLOCKED',blockers=[reason[:80]]))
   raise
  finally:self.calendar.close();mt5.shutdown()

def main():
 p=argparse.ArgumentParser();p.add_argument('--execute-demo',action='store_true');p.add_argument('--batch-id',required=True)
 p.add_argument('--continue-from')
 a=p.parse_args()
 import re
 if not a.execute_demo or not re.fullmatch(r'v51_demo10_20261014_[0-9]{6}',a.batch_id):raise ArcSafetyError('EXPLICIT_BOUNDED_DEMO_AUTHORIZATION_REQUIRED')
 if a.continue_from and not re.fullmatch(r'v51_demo10_20261014_[0-9]{6}',a.continue_from):
  raise ArcSafetyError('CONTINUATION_PARENT_ID_INVALID')
 import MetaTrader5 as mt5
 parent=ROOT/'logs'/'arc_v1'/a.continue_from if a.continue_from else None
 return Session(a.batch_id).main(mt5,ROOT/'logs'/'arc_v1'/a.batch_id,continuation_parent=parent)
if __name__=='__main__':
 try:raise SystemExit(main())
 except ArcSafetyError as exc:print('V51_DEMO_STOP='+str(exc),flush=True);raise SystemExit(2)