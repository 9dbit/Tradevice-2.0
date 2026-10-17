"""Outbound demo control client. No broker SDK, uploaded code, or shell commands.
Only the locally reviewed v51_dashboard_runtime adapter can perform demo execution.
"""
import hashlib,hmac,http.client,json,os,re,sqlite3,threading,time,uuid
from pathlib import Path
from demo_settings import SETTINGS_PROTOCOL,validate_settings
from validation_gate import start_blocker,automatic_blocker

API='https://copy-api-staging-4c33.up.railway.app/internal/master/demo/exchange'
APPROVED_HASH='bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee'
CHECKS=('identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash','atr','adx')
AUTOMATIC_PROTOCOL='V51_AUTOMATIC_20261017'

def sign(secret,stamp,body):
 return hmac.new(bytes.fromhex(secret),b'tradevice-demo-v1\n'+stamp.encode()+b'\n'+body,hashlib.sha256).hexdigest()

class ExchangeClient:
 """Reuse TLS for heartbeats; a failed exchange is never blindly replayed here."""
 def __init__(self,secret,connection_factory=http.client.HTTPSConnection):
  self.secret=secret;self.factory=connection_factory;self.connection=None
 def send(self,p):
  body=json.dumps(p,separators=(',',':')).encode();stamp=str(p['observedMs'])
  try:
   if self.connection is None:self.connection=self.factory('copy-api-staging-4c33.up.railway.app',timeout=6)
   self.connection.request('POST','/internal/master/demo/exchange',body,{'Content-Type':'application/json','x-tradevice-demo-time':stamp,'x-tradevice-demo-signature':sign(self.secret,stamp,body)})
   r=self.connection.getresponse();raw=r.read(32769)
   if r.status!=200:raise ValueError('BRIDGE_HTTP_'+str(r.status))
   if len(raw)>32768 or not hmac.compare_digest(sign(self.secret,stamp,raw),r.getheader('x-tradevice-demo-signature','')):raise ValueError('BRIDGE_INVALID_RESPONSE')
   result=json.loads(raw)
   if type(result.get('serverMs')) is not int or abs(time.time()*1000-result['serverMs'])>10000:raise ValueError('BRIDGE_STALE_RESPONSE')
   return result
  except Exception:
   if self.connection is not None:self.connection.close()
   self.connection=None
   raise

def heartbeat_delay(elapsed):return max(.05,1.-elapsed)

class Controller:
 def __init__(self,path,runtime,clock=time.time):
  self.clock=clock;self.runtime=runtime;self.lock=threading.RLock();self.boot=str(uuid.uuid4())
  self.db=sqlite3.connect(path,check_same_thread=False,isolation_level=None)
  self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
  self.db.execute('CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,error TEXT,confirmed INTEGER NOT NULL DEFAULT 0)')
  if 'diagnostics' not in {r[1] for r in self.db.execute('PRAGMA table_info(receipts)')}:self.db.execute('ALTER TABLE receipts ADD COLUMN diagnostics TEXT')
  self.db.execute("UPDATE receipts SET status='UNCERTAIN',error='PROCESS_RESTART_RECONCILIATION_REQUIRED' WHERE status='PROCESSING'")
  self.db.execute('CREATE TABLE IF NOT EXISTS active_run(singleton INTEGER PRIMARY KEY CHECK(singleton=1),request_id TEXT)')
  self.db.execute('INSERT OR IGNORE INTO active_run VALUES(1,NULL)')
  interrupted=self.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()[0]
  self.recovery=bool(interrupted) or bool(self.db.execute("SELECT 1 FROM receipts WHERE status='UNCERTAIN' LIMIT 1").fetchone())
  self.active=None;self.revision=0;self.state='RECOVERY_REQUIRED' if self.recovery else 'OFF';self.thread=None;self.emergency_thread=None
  self.kill=True;self.reason=None;self.mode=None;self.last_ok=0;self.last_stamp=0;self.calendar_protocol=False
  self.last_reconcile=-float('inf')
  self.automatic=False;self.auto_completed=0;self.auto_cycle=None;self.auto_blockers=[];self.auto_wake=threading.Event()
 def reconcile_completed_close(self):
  if not self.recovery or self.running() or not hasattr(self.runtime,'reconcile_completed_close') or self.clock()-self.last_reconcile<30:return
  self.last_reconcile=self.clock()
  if self.db.execute("SELECT 1 FROM receipts WHERE status IN ('PROCESSING','UNCERTAIN') LIMIT 1").fetchone():return
  prior=self.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()[0]
  if not prior:return
  try:
   evidence=self.runtime.emergency_snapshot()
   if not evidence or evidence.get('phase')!='COMPLETE':return
   rid=evidence['requestId'];row=self.db.execute('SELECT payload,status FROM receipts WHERE id=?',(rid,)).fetchone()
   if not row or row[1]!='APPLIED' or json.loads(row[0]).get('action')!='EMERGENCY_CLOSE':return
   proof=self.runtime.reconcile_completed_close(prior,rid)
   if (proof.get('prior_run')!=prior or proof.get('close_request_id')!=rid or proof.get('broker_flat') is not True
       or proof.get('orders_sent')!=0 or proof.get('new_cycle_started') is not False):raise ValueError('CLOSE_RECONCILIATION_INVALID')
   self.db.execute('BEGIN IMMEDIATE')
   try:
    self.db.execute('CREATE TABLE IF NOT EXISTS recovery_audit(request_id TEXT PRIMARY KEY,proof TEXT NOT NULL,at_ms INTEGER NOT NULL)')
    self.db.execute('INSERT INTO recovery_audit VALUES(?,?,?)',(prior,json.dumps(proof),int(self.clock()*1000)))
    if self.db.execute('UPDATE active_run SET request_id=NULL WHERE singleton=1 AND request_id=?',(prior,)).rowcount!=1:raise ValueError('CLOSE_RECONCILIATION_RUN_CHANGED')
    self.db.execute('COMMIT')
   except BaseException:self.db.execute('ROLLBACK');raise
   self.recovery=False;self.state='STOPPED';self.reason=None
  except Exception:
   # Never turn unavailable/ambiguous history into permission to start.
   self.reason='PRIOR_CYCLE_RECONCILIATION_REQUIRED'
 def snapshot(self):
  with self.lock:
   self.reconcile_completed_close()
   checks={k:False for k in CHECKS};blockers=[]
   if not self.running():
    try:checks,blockers=self.runtime.preflight()
    except Exception:blockers=['PREFLIGHT_UNAVAILABLE']
   else:
    checks=self.runtime.checks()
   if self.recovery:
    checks['reconciled']=False
    blockers.append('ENGINE_RECOVERY_REQUIRED' if self.reason else 'PROCESS_RESTART_RECONCILIATION_REQUIRED')
   if self.reason:blockers.append(self.reason)
   if self.automatic and self.state=='AUTO_WAITING':blockers.extend(self.auto_blockers)
   now=int(self.clock()*1000)
   self.last_stamp=max(now,self.last_stamp+1)
   receipts=[dict(requestId=i,status=s,errorCode=e,**({'diagnostics':json.loads(d)} if d else {})) for i,s,e,d in self.db.execute("SELECT id,status,error,diagnostics FROM receipts WHERE status!='PROCESSING' AND confirmed=0 LIMIT 16")]
   payload=dict(settingsProtocol=SETTINGS_PROTOCOL,observedMs=self.last_stamp,bootId=self.boot,activeSkillId=self.active,
    activeHash=APPROVED_HASH if self.active else None,revision=self.revision,state=self.state,
    checks=checks,blockers=list(dict.fromkeys(blockers))[:20],receipts=receipts)
   if hasattr(self.runtime,'preflight_evidence'):payload['preflightEvidence']=self.runtime.preflight_evidence()
   payload['automatic']=dict(protocol=AUTOMATIC_PROTOCOL,enabled=self.automatic,completedCycles=self.auto_completed,cycleRequestId=self.auto_cycle)
   if self.calendar_protocol:payload['news']=self.runtime.news_snapshot() if hasattr(self.runtime,'news_snapshot') else None
   if hasattr(self.runtime,'emergency_snapshot'):
    from emergency_state import PROTOCOL
    payload['emergencyCloseProtocol']=PROTOCOL;payload['emergencyClose']=self.runtime.emergency_snapshot()
   return payload
 def trade_running(self):return self.thread is not None and self.thread.is_alive()
 def emergency_running(self):return self.emergency_thread is not None and self.emergency_thread.is_alive()
 def running(self):return self.trade_running() or self.emergency_running()
 def acknowledge(self,rid,status,error=None,diagnostics=None):
  with self.lock:self.db.execute('UPDATE receipts SET status=?,error=?,diagnostics=?,confirmed=0 WHERE id=?',(status,error,json.dumps(diagnostics) if diagnostics else None,rid))
 def received(self,result):
  with self.lock:
   self.calendar_protocol=result.get('calendarEvidencePolicy')=='SCHEDULE_6H_V1'
   self.last_ok=self.clock();self.kill=result.get('killSwitch') is not False
   if self.automatic and self.kill:self.cancel_automatic('MANUAL_KILL')
   if self.kill and self.running():self.runtime.suspend('MANUAL_KILL');self.state='STOPPING'
   for rid in result.get('confirmed',[]):self.db.execute("UPDATE receipts SET confirmed=1 WHERE id=? AND status!='PROCESSING'",(rid,))
   selection=result['selection']
   if self.automatic and (selection['revision']!=self.revision or selection['skillId']!=self.active or selection['sha256']!=APPROVED_HASH):self.cancel_automatic('AUTOMATIC_SELECTION_CHANGED')
   if selection['revision']!=self.revision or selection['skillId']!=self.active:
    if not self.running() and not self.recovery:
     if selection['skillId'] is None:
      self.active=None;self.revision=selection['revision'];self.state='OFF';self.reason=None
     elif selection['sha256']==APPROVED_HASH:
      try:self.runtime.activate(APPROVED_HASH)
      except Exception:self.state='BLOCKED';self.reason='ENGINE_FINGERPRINT_MISMATCH'
      else:self.active=selection['skillId'];self.revision=selection['revision'];self.state='READY';self.reason=None
     else:self.state='BLOCKED';self.reason='SKILL_ADAPTER_NOT_APPROVED'
   commands=result.get('commands',[]);closing=any(c.get('action')=='EMERGENCY_CLOSE' for c in commands)
   for command in sorted(commands,key=lambda c:c.get('action')!='EMERGENCY_CLOSE'):
    if closing and command.get('action')=='START':
     rid=str(uuid.UUID(command['requestId']))
     self.db.execute("INSERT OR IGNORE INTO receipts(id,payload,status,error) VALUES(?,?,'REJECTED','EMERGENCY_SUPERSEDED')",(rid,json.dumps(command,sort_keys=True)))
    else:self.command(command)
 def command(self,c):
  rid=str(uuid.UUID(c['requestId']));raw=json.dumps(c,sort_keys=True)
  # Durable PROCESSING precedes any engine operation. Retries never launch twice.
  old=self.db.execute('SELECT payload FROM receipts WHERE id=?',(rid,)).fetchone()
  if old:return
  self.db.execute('INSERT INTO receipts(id,payload,status) VALUES(?,?,?)',(rid,raw,'PROCESSING'))
  if type(c.get('expiresMs')) is not int or self.clock()*1000>=c['expiresMs']:
   self.acknowledge(rid,'REJECTED','COMMAND_EXPIRED');return
  if c['action']=='EMERGENCY_CLOSE':
   if c.get('confirmClose') is not True or not hasattr(self.runtime,'begin_emergency'):
    self.acknowledge(rid,'REJECTED','EMERGENCY_NOT_SUPPORTED');return
   if self.emergency_running():self.acknowledge(rid,'REJECTED','EMERGENCY_ALREADY_ACTIVE');return
   self.automatic=False;self.auto_wake.set()
   try:self.runtime.begin_emergency(rid,c['expiresMs'])
   except Exception:self.acknowledge(rid,'REJECTED','EMERGENCY_INTENT_WRITE_FAILED');return
   self.mode='EMERGENCY_CLOSE';self.state='STOPPING';self.reason='EMERGENCY_CLOSE_ACTIVE';self.recovery=True
   try:self.runtime.suspend('OPERATOR_EMERGENCY_CLOSE')
   except Exception:pass # The durable entry latch is authoritative.
   prior=self.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()[0]
   def close_all():
    try:
     while self.trade_running():
      if self.clock()*1000>=c['expiresMs']:raise ValueError('EMERGENCY_WAITING_ENGINE')
      time.sleep(.05)
     if (c.get('settings') or {}).get('close_scope')=='ALL_DEMO_ACCOUNT':
      proof=self.runtime.emergency_close(rid,c['expiresMs'],prior,scope='ALL_DEMO_ACCOUNT')
     else:proof=self.runtime.emergency_close(rid,c['expiresMs'],prior)
     if proof.get('broker_flat') is not True:raise ValueError('EMERGENCY_FLAT_UNCONFIRMED')
     with self.lock:
      current=self.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()[0]
      if current!=prior:raise ValueError('EMERGENCY_ACTIVE_RUN_CHANGED')
      if not proof.get('reconciliation_required'):self.db.execute('UPDATE active_run SET request_id=NULL WHERE singleton=1')
      # A later explicit close may independently reconcile an interrupted close.
      for old_id,body in self.db.execute("SELECT id,payload FROM receipts WHERE status='UNCERTAIN'").fetchall():
       if json.loads(body).get('action')=='EMERGENCY_CLOSE':self.acknowledge(old_id,'APPLIED')
      self.acknowledge(rid,'APPLIED')
      self.recovery=bool(proof.get('reconciliation_required')) or bool(self.db.execute("SELECT 1 FROM receipts WHERE status='UNCERTAIN' LIMIT 1").fetchone())
      self.state='RECOVERY_REQUIRED' if self.recovery else 'STOPPED';self.reason=('PRIOR_CYCLE_RECONCILIATION_REQUIRED' if proof.get('reconciliation_required') else 'PRIOR_COMMAND_UNCONFIRMED') if self.recovery else None
    except Exception as exc:
     code=str(exc) if re.fullmatch('EMERGENCY_[A-Z_]{1,80}',str(exc)) else 'EMERGENCY_RECONCILIATION_REQUIRED'
     with self.lock:
      self.recovery=True;self.state='RECOVERY_REQUIRED';self.reason=code;self.acknowledge(rid,'UNCERTAIN',code)
     try:self.runtime.emergency_failed(code)
     except Exception:pass
   self.emergency_thread=threading.Thread(target=close_all,daemon=False);self.emergency_thread.start();return
  if c['action'] in ('PAUSE','STOP'):
   self.automatic=False;self.auto_wake.set()
   if self.recovery:
    if self.running() or not hasattr(self.runtime,'retire_pending'):
     self.acknowledge(rid,'REJECTED','RECOVERY_CONTROL_UNAVAILABLE');return
    self.mode=c['action'];self.runtime.suspend('OPERATOR_'+c['action'])
    def retire():
     try:
      proof=self.runtime.retire_pending(rid,c['expiresMs'])
      if proof.get('pending_retired') is not True:raise ValueError('PENDING_RETIREMENT_UNCONFIRMED')
      self.acknowledge(rid,'APPLIED')
     except Exception as exc:
      self.acknowledge(rid,'REJECTED' if str(exc)=='EMERGENCY_SUPERSEDED_CONTROL' else 'UNCERTAIN',
       'EMERGENCY_SUPERSEDED_CONTROL' if str(exc)=='EMERGENCY_SUPERSEDED_CONTROL' else 'PENDING_RETIREMENT_UNCONFIRMED')
     # Recovery and the active pointer remain locked, even with no pending orders.
    self.thread=threading.Thread(target=retire,daemon=False);self.thread.start();return
   self.mode=c['action']
   if self.running():
    self.runtime.suspend('OPERATOR_'+c['action']);self.state='PAUSING' if self.mode=='PAUSE' else 'STOPPING'
   else:self.state='PAUSED' if self.mode=='PAUSE' else 'STOPPED'
   self.acknowledge(rid,'APPLIED');return
  if c['action']!='START' or self.kill or self.recovery or self.running() or self.state not in ('READY','PAUSED','STOPPED'):
   self.acknowledge(rid,'REJECTED','ENGINE_NOT_READY');return
  if not self.active or (c['skillId'],c['sha256'],c['revision'])!=(self.active,APPROVED_HASH,self.revision):
   self.acknowledge(rid,'REJECTED','SKILL_ENGINE_ACK_MISMATCH');return
  gate=start_blocker(c.get('cycleMode','CUSTOM'),c.get('targetCycles'))
  if gate:
   self.acknowledge(rid,'REJECTED',gate);return
  if c.get('cycleMode')=='AUTOMATIC':
   if c.get('targetCycles') is not None:self.acknowledge(rid,'REJECTED','AUTOMATIC_TARGET_INVALID');return
   try:self.runtime.activate(APPROVED_HASH);settings=validate_settings(c.get('settings'))
   except Exception:self.acknowledge(rid,'REJECTED','PREFLIGHT_FAILED');return
   self.automatic=True;self.auto_completed=0;self.auto_cycle=None;self.auto_blockers=[];self.auto_wake.clear()
   self.state='AUTO_WAITING';self.mode=None;self.reason=None
   self.acknowledge(rid,'APPLIED')
   self.thread=threading.Thread(target=self.execute_automatic,args=(settings,),daemon=False);self.thread.start();return
  if c.get('cycleMode') not in (None,'CUSTOM'):
   self.acknowledge(rid,'REJECTED','CYCLE_MODE_INVALID');return
  if type(c.get('targetCycles')) is not int or not 1<=c['targetCycles']<=10:
   self.acknowledge(rid,'REJECTED','BOUNDED_DEMO_REQUIRED');return
  try:
   self.runtime.activate(APPROVED_HASH)
   settings=validate_settings(c.get('settings'))
   checks,blockers=self.runtime.preflight(settings)
   if blockers or not all(checks.get(k) is True for k in CHECKS):
    evidence=self.runtime.preflight_evidence() if hasattr(self.runtime,'preflight_evidence') else None
    self.acknowledge(rid,'REJECTED',blockers[0] if blockers else 'PREFLIGHT_FAILED',evidence);return
  except Exception:self.acknowledge(rid,'REJECTED','PREFLIGHT_FAILED');return
  self.state='STARTING';self.mode=None;self.reason=None
  self.auto_cycle=None;self.auto_completed=0
  self.db.execute('UPDATE active_run SET request_id=? WHERE singleton=1',(rid,))
  self.runtime.prepare(settings)
  def execute():
   started=False
   def ready():
    nonlocal started
    started=True
    with self.lock:
     if self.state=='STARTING':self.state='RUNNING'
     self.acknowledge(rid,'APPLIED')
   try:
    flat=self.runtime.run(rid,c['targetCycles'],ready,c['expiresMs'])
    with self.lock:
     if self.mode=='EMERGENCY_CLOSE':pass
     elif flat is not True and flat!='RISK_STOP_FLAT':self.recovery=True;self.state='RECOVERY_REQUIRED';self.reason='BROKER_FLAT_UNCONFIRMED'
     else:
      self.db.execute('UPDATE active_run SET request_id=NULL WHERE singleton=1')
      self.state='PAUSED' if self.mode=='PAUSE' else 'STOPPED'
    if not started:self.acknowledge(rid,'REJECTED',getattr(self.runtime,'entry_blocker',None) or 'ENTRY_NOT_STARTED')
   except Exception:
    with self.lock:
     if self.mode!='EMERGENCY_CLOSE':self.recovery=True;self.state='RECOVERY_REQUIRED';self.reason='ENGINE_RECOVERY_REQUIRED'
    if not started:self.acknowledge(rid,'UNCERTAIN','ENGINE_START_UNCONFIRMED')
  self.thread=threading.Thread(target=execute,daemon=False);self.thread.start()
 def cancel_automatic(self,reason):
  self.automatic=False;self.auto_wake.set();self.runtime.suspend(reason);self.reason=reason;self.state='STOPPING'
 def execute_automatic(self,settings):
  # Defense in depth: even direct invocation of the legacy worker is locked.
  # No settings, heartbeat or remote command authorizes an automatic cycle.
  with self.lock:
   self.automatic=False
   self.auto_wake.set()
   self.reason=automatic_blocker()
   if self.state=='AUTO_WAITING':self.state='STOPPED'
  return
 def disconnected(self):
  with self.lock:
   if self.automatic and self.clock()-self.last_ok>8:self.cancel_automatic('BRIDGE_CONNECTION_LOST')
   if self.running() and self.clock()-self.last_ok>10:
    self.runtime.suspend('BRIDGE_CONNECTION_LOST');self.state='STOPPING';self.reason='BRIDGE_CONNECTION_LOST'

class ProcessLock:
 def __init__(self,path):self.path=path
 def __enter__(self):
  self.file=open(self.path,'a+b');self.file.seek(0);self.file.write(b'0');self.file.flush();self.file.seek(0)
  if os.name=='nt':
   import msvcrt
   msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
  else:
   import fcntl
   fcntl.flock(self.file,fcntl.LOCK_EX|fcntl.LOCK_NB)
  return self
 def __exit__(self,*args):self.file.close()

def main():
 import argparse,sys
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args()
 root=Path(a.root).resolve()
 if root.name!='GoldTrapCore_v0.2_v51_research_20261013':raise RuntimeError('ISOLATED_CLONE_REQUIRED')
 secret=(root/'read_only'/'demo_bridge.secret').read_text().strip()
 if not re.fullmatch('[a-f0-9]{64}',secret):raise RuntimeError('DEMO_SECRET_INVALID')
 sys.path.insert(0,str(root))
 from v51_dashboard_runtime import Runtime
 with ProcessLock(root/'read_only'/'demo_bridge.lock'):
  controller=Controller(root/'read_only'/'demo_bridge.sqlite3',Runtime(root))
  client=ExchangeClient(secret)
  while True:
   started=time.monotonic()
   try:
    result=client.send(controller.snapshot());controller.received(result)
   except Exception:controller.disconnected()
   time.sleep(heartbeat_delay(time.monotonic()-started))
if __name__=='__main__':main()
