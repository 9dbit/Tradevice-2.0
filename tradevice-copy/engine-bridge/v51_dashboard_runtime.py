"""Reviewed local adapter for the V5.1 isolated clone. Startup/preflight is read-only.
Only explicit START or EMERGENCY_CLOSE commands can construct execution adapters.
"""
import hashlib,json,threading,time
from pathlib import Path
from demo_settings import default_settings,validate_settings
from v51_execution_settings import configure_adapter
from v51_market_preflight import inspect_market

APPROVED_HASH='bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee'
KEYS=('identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash','atr','adx')
class Runtime:
 def __init__(self,root):
  self.root=Path(root);self.reason=None;self._checks={k:False for k in KEYS};self.checked_at=0
  from v51_runtime_calendar import RuntimeCalendar
  self.calendar=RuntimeCalendar();self.calendar.start()
 def news_snapshot(self):return self.calendar.export()
 def emergency_snapshot(self):
  from emergency_state import read,PROTOCOL
  try:
   value=read(self.root)
   return dict(value,protocol=PROTOCOL) if value else None
  except ValueError:return None
 def begin_emergency(self,request_id,expires_ms):
  from emergency_state import begin
  # Verify reviewed source, independently of entry/news/ATR/margin readiness.
  self.fingerprint();return begin(self.root,request_id,expires_ms)
 def emergency_failed(self,code):
  from emergency_state import update
  update(self.root,'RECONCILIATION_REQUIRED')
 def emergency_close(self,request_id,expires_ms,prior_run,scope=None):
  if scope!='ALL_DEMO_ACCOUNT':
   from v51_emergency_close import execute as legacy
   return legacy(self.root,request_id,expires_ms,prior_run,self.fingerprint)
  from v51_account_close import execute
  result=execute(self.root,request_id,expires_ms,self.fingerprint)
  if prior_run:
   try:
    from v51_emergency_close import project_closed_batch
    project_closed_batch(self.root,prior_run,{cid:p['history'] for cid,p in result.get('prior_cancel_proofs',{}).items()})
   except Exception:result['reconciliation_required']=True
  return result
 def retire_pending(self,request_id,expires_ms):
  from v51_account_close import execute
  return execute(self.root,request_id,expires_ms,self.fingerprint,close_positions=False)
 def fingerprint(self):
  manifest=json.loads((self.root/'read_only'/'demo_engine_fingerprint.json').read_text())
  files=manifest['files']
  if manifest['skillHash']!=APPROVED_HASH or len(files)<10 or 'v51_market_preflight.py' not in files:raise ValueError('ENGINE_FINGERPRINT_INVALID')
  for relative,expected in files.items():
   path=(self.root/relative).resolve()
   if not path.is_relative_to(self.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ValueError('ENGINE_FINGERPRINT_MISMATCH')
 def activate(self,sha):
  if sha!=APPROVED_HASH:raise ValueError('SKILL_NOT_APPROVED')
  self.fingerprint()
 def checks(self):
  # Do not promote an old preflight into fresh readiness while a run owns MT5.
  return dict(self._checks) if time.time()-self.checked_at<=5 else {k:False for k in KEYS}
 def preflight_evidence(self):
  value=getattr(self,'_preflight_evidence',None)
  return json.loads(json.dumps(value)) if value else None
 def preflight(self,settings=None):
  import MetaTrader5 as mt5
  from goldtrap_arc.mt5_adapter import MT5ArcAdapter
  from goldtrap_arc.persistence import ArcLedger,ArcStateStore
  from v51_batch_research import margin_envelope
  from goldtrap_arc.config import ArcSafetyError
  settings=validate_settings(settings or default_settings())
  self._preflight_evidence=None
  checks={k:False for k in KEYS};blockers=[];margin={};market=None
  try:self.fingerprint();checks['engineHash']=True
  except Exception:blockers.append('ENGINE_FINGERPRINT_MISMATCH')
  a=MT5ArcAdapter(mt5,allow_execution=False)
  try:
   a.initialize();configure_adapter(a,settings or default_settings());a.guard_identity();account,terminal,symbol=a.identity()
   checks['identity']=account.trade_mode==mt5.ACCOUNT_TRADE_MODE_DEMO and account.server=='Exness-MT5Trial14' and symbol.name=='XAUUSDm'
   pos,orders=mt5.positions_get(),mt5.orders_get()
   checks['brokerFlat']=pos is not None and orders is not None and not pos and not orders
   snap=a.snapshot(require_fresh_tick=False)
   checks['quote']=a.quote_metrics(snap.tick)['fresh']
   checks['spread']=checks['quote'] and 0<=a.spread_points(snap)<=a.cfg.spread_limit_points
   try:margin_envelope(a,evidence=margin);checks['margin']=True
   except Exception as exc:
    # Preserve the failed check; distinguish a verified shortfall from missing
    # broker evidence. Never publish arbitrary exception text or account data.
    blockers.append('MARGIN_ENVELOPE_INSUFFICIENT' if isinstance(exc,ArcSafetyError) and
     str(exc)=='RESEARCH_MARGIN_ENVELOPE_INSUFFICIENT' else 'MARGIN_ENVELOPE_UNVERIFIED')
   market_checks,market_blockers,market=inspect_market(a)
   checks.update(market_checks);blockers.extend(market_blockers)
   deals,_=a._raw_history()
   owned=[d for d in deals if getattr(d,'symbol','')=='XAUUSDm' and getattr(d,'magic',0)==a.cfg.magic and getattr(d,'type',-1) in (0,1)]
   checks['commission']=bool(owned) and all(getattr(d,'commission',None)==0 and getattr(d,'fee',None)==0 for d in owned)
   try:self.reconcile_prior(a,write=False);checks['reconciled']=checks['brokerFlat']
   except Exception:blockers.append('PRIOR_CYCLE_RECONCILIATION_REQUIRED')
  except Exception:blockers.append('BROKER_PREFLIGHT_UNAVAILABLE')
  finally:mt5.shutdown()
  news=self.calendar.decision();checks['news']=news.get('status')=='CLEAR' and news.get('entries_allowed') is True
  from emergency_state import requested
  try:
   if requested(self.root):checks['reconciled']=False;blockers.append('EMERGENCY_CLOSE_UNRESOLVED')
  except ValueError:checks['reconciled']=False;blockers.append('EMERGENCY_INTENT_INVALID')
  blockers.extend('PREFLIGHT_'+k.upper() for k,v in checks.items() if not v)
  self._checks=checks;self.checked_at=time.time()
  self._preflight_evidence=dict(observedMs=int(self.checked_at*1000),settings=settings,checks=dict(checks),blockers=list(blockers),margin=margin or None,market=market)
  return checks,blockers
 def reconcile_completed_close(self,prior_run,close_id):
  from v51_close_reconciliation import reconcile_closed_run
  return reconcile_closed_run(self.root,prior_run,close_id,self.fingerprint,self.reconcile_prior)
 def reconcile_prior(self,adapter,write=True,cancel_proofs=None):
  from goldtrap_arc.persistence import ArcLedger,ArcStateStore,atomic_json
  adapter.guard_identity()
  positions,orders=adapter.mt5.positions_get(),adapter.mt5.orders_get()
  if positions is None or orders is None or positions or orders:raise ValueError('BROKER_NOT_FLAT')
  proved=set();evidence=[]
  for p in (self.root/'logs'/'arc_v1').rglob('arc_state.json'):
   before=p.read_bytes();state=ArcStateStore(p.parent).load();ledger=ArcLedger(p.parent)
   from v51_close_reconciliation import matches_cancel_proof
   candidate=cancel_proofs is not None and matches_cancel_proof(p,ledger,cancel_proofs)
   if ledger.unresolved_requests():
    from v51_account_close import proves_cancel_reconciliation
    if not candidate and not proves_cancel_reconciliation(self.root,p,ledger):raise ValueError('PRIOR_REQUEST_UNRESOLVED')
   if not state.get('cycles_started') or str(state.get('state','')).startswith('COMPLETE'):continue
   if not state.get('cycle_id'):raise ValueError('PRIOR_CYCLE_ID_MISSING')
   life=adapter.cycle_lifecycle(state['cycle_id'])
   if life.get('all_closed') is not True or not life.get('entry_deals'):
    from v51_emergency_close import cancelled_only_proof
    from v51_account_close import proves_cancel_reconciliation
    if not cancelled_only_proof(self.root,p,ledger,life) and not (not life.get('entry_deals') and not life.get('exit_deals') and (candidate or proves_cancel_reconciliation(self.root,p,ledger))):
     raise ValueError('PRIOR_HISTORY_NOT_CLOSED')
   if before!=p.read_bytes() or ledger.tail!=ArcLedger(p.parent).tail:raise ValueError('PRIOR_JOURNAL_CHANGED')
   proved.add(str(p.resolve()))
   evidence.append(dict(cycle_id=state['cycle_id'],state_sha256=hashlib.sha256(before).hexdigest(),ledger_tail=ledger.tail,
    history_all_closed=True,entry_count=len(life['entry_deals']),exit_count=len(life['exit_deals'])))
  if write:
   atomic_json(self.root/'read_only'/'dashboard_prior_reconciliation.json',dict(observed_ms=int(time.time()*1000),read_only=True,
    broker_flat=True,evidence=evidence,original_journals_modified=False,counted_in_new_run=False))
  return proved
 def prepare(self,settings):self.settings=validate_settings(settings);self.reason=None;self.entry_blocker=None
 def suspend(self,reason):self.reason=reason
 def run(self,request_id,target,ready,expires_ms):
  import MetaTrader5 as mt5
  from v51_demo_batch_runtime import Session
  from v51_batch_core import run,ArcSafetyError
  from v51_batch_research import ResearchBatchAdapter
  from v51_batch_telemetry import report,publish,stop_blockers
  outer=self;batch_id='v51_dashboard_'+request_id.replace('-','')
  root=self.root/'logs'/'arc_v1'/batch_id
  class DashboardSession(Session):
   def decision(self,*,active_cycle=False):
    if outer.reason:return dict(status='UNKNOWN',reason=outer.reason,entries_allowed=False)
    return super().decision(active_cycle=active_cycle)
   def admission(self,adapter):
    # Authorization may expire while startup is fetching a calendar. Never
    # dispatch a first order under an expired dashboard START.
    if not self.manifest or not self.manifest.get('slots'):
     if time.time()*1000>=expires_ms:raise ArcSafetyError('DASHBOARD_START_EXPIRED')
    outer.fingerprint()
    configure_adapter(adapter,outer.settings)
    if outer.reason:raise ArcSafetyError('DASHBOARD_ENTRY_SUSPENDED')
    result=super().admission(adapter)
    # Re-evaluate after acknowledgement/calendar waits, before EVERY new cycle.
    checks,reasons,market=inspect_market(adapter)
    outer.entry_blocker=reasons[0] if reasons else None
    if not all(checks.values()):return False
    return result
   def engine(self,*args,**kwargs):
    kwargs['cfg']=args[0].cfg
    engine=super().engine(*args,**kwargs)
    original=engine.news_provider
    def admission_guard():
     if len((self.manifest or {}).get('slots',[]))<=1 and not engine.state.get('cycle_id') and time.time()*1000>=expires_ms:
      return dict(status='UNKNOWN',reason='DASHBOARD_START_EXPIRED',entries_allowed=False)
     return original()
    engine.news_provider=admission_guard
    ready();return engine
   def emit(self,m,engine=None,force=False):
    self.manifest=m;self.last_engine=engine
    now=self.clock()
    if not force and now-self.last_emit<1:return
    self.last_emit=now;slots=m.get('slots',[]);status=m.get('status','PREFLIGHT')
    completed=sum(s.get('result',{}).get('broker_flat_confirmed') is True and s.get('result',{}).get('layers',0)>0 for s in slots)
    mapped=('COMPLETED' if completed==target else 'STOPPED') if status=='AUTO_STOP_10_CYCLES' else ('STOPPED' if status.startswith('STOPPED_') else status)
    if mapped=='WAITING_CALENDAR_REFRESH':mapped='SUSPENDED'
    blockers=([outer.reason] if outer.reason else [])+([outer.entry_blocker] if getattr(outer,'entry_blocker',None) else [])+stop_blockers(m,engine)
    if engine and engine.state.get('news_entry_suspended'):
     blockers.append(engine.state.get('news_reason','ENTRY_SUSPENDED'))
    payload=report(batch_id,mapped,slots,blockers,int(now*1000));payload['requested']=target
    try:publish(payload);self.write_failed=False
    except Exception:self.write_failed=True
  session=DashboardSession(batch_id);session.calendar.close();session.calendar=self.calendar
  session.emit(dict(status='PREFLIGHT',slots=[]),force=True)
  try:
   result=run(root,False,mt5,fixed_arming='PREARM_BOTH',engine_class=session.engine,
    adapter_class=ResearchBatchAdapter,admission=session.admission,reporter=session.emit,cycle_limit=target,stop_requested=lambda:bool(outer.reason),prior_reconciliation=self.reconcile_prior)
   # run() only returns after cycle history + broker-flat reconciliation.
   return result==0
  except ArcSafetyError as exc:
   from v51_terminal_reconciliation import RISK_STOP_MESSAGE,RISK_STOP_FLAT,prove_risk_stop
   if str(exc)!=RISK_STOP_MESSAGE:raise
   from goldtrap_arc.mt5_adapter import MT5ArcAdapter
   from goldtrap_arc.persistence import ArcLedger
   from v51_batch_core import IDENTITY
   adapter=MT5ArcAdapter(mt5,allow_execution=False)
   adapter.initialize()
   prove_risk_stop(self.root,request_id,adapter,ArcLedger,IDENTITY)
   return RISK_STOP_FLAT
  finally:mt5.shutdown()
