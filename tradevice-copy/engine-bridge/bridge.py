"""Outbound demo control client. No broker SDK, uploaded code, or shell commands.
Only the locally reviewed v51_dashboard_runtime adapter can perform demo execution.
"""
import hashlib,hmac,http.client,json,os,re,sqlite3,threading,time,uuid
from pathlib import Path

API='https://copy-api-staging-4c33.up.railway.app/internal/master/demo/exchange'
APPROVED_HASH='bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee'
CHECKS=('identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash')

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

def heartbeat_delay(elapsed):return max(.5,1.5-elapsed)

class Controller:
 def __init__(self,path,runtime,clock=time.time):
  self.clock=clock;self.runtime=runtime;self.lock=threading.RLock();self.boot=str(uuid.uuid4())
  self.db=sqlite3.connect(path,check_same_thread=False,isolation_level=None)
  self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
  self.db.execute('CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,error TEXT,confirmed INTEGER NOT NULL DEFAULT 0)')
  self.db.execute("UPDATE receipts SET status='UNCERTAIN',error='PROCESS_RESTART_RECONCILIATION_REQUIRED' WHERE status='PROCESSING'")
  self.db.execute('CREATE TABLE IF NOT EXISTS active_run(singleton INTEGER PRIMARY KEY CHECK(singleton=1),request_id TEXT)')
  self.db.execute('INSERT OR IGNORE INTO active_run VALUES(1,NULL)')
  interrupted=self.db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()[0]
  self.recovery=bool(interrupted) or bool(self.db.execute("SELECT 1 FROM receipts WHERE status='UNCERTAIN' LIMIT 1").fetchone())
  self.active=None;self.revision=0;self.state='RECOVERY_REQUIRED' if self.recovery else 'OFF';self.thread=None
  self.kill=True;self.reason=None;self.mode=None;self.last_ok=0;self.last_stamp=0
 def snapshot(self):
  with self.lock:
   checks={k:False for k in CHECKS};blockers=[]
   if not self.running():
    try:checks,blockers=self.runtime.preflight()
    except Exception:blockers=['PREFLIGHT_UNAVAILABLE']
   else:
    checks=self.runtime.checks()
   if self.recovery:blockers.append('PROCESS_RESTART_RECONCILIATION_REQUIRED')
   if self.reason:blockers.append(self.reason)
   now=int(self.clock()*1000)
   self.last_stamp=max(now,self.last_stamp+1)
   receipts=[dict(requestId=i,status=s,errorCode=e) for i,s,e in self.db.execute("SELECT id,status,error FROM receipts WHERE status!='PROCESSING' AND confirmed=0 LIMIT 16")]
   return dict(observedMs=self.last_stamp,bootId=self.boot,activeSkillId=self.active,
    activeHash=APPROVED_HASH if self.active else None,revision=self.revision,state=self.state,
    checks=checks,blockers=blockers[:20],receipts=receipts)
 def running(self):return self.thread is not None and self.thread.is_alive()
 def acknowledge(self,rid,status,error=None):
  with self.lock:self.db.execute('UPDATE receipts SET status=?,error=? WHERE id=?',(status,error,rid))
 def received(self,result):
  with self.lock:
   self.last_ok=self.clock();self.kill=result.get('killSwitch') is not False
   if self.kill and self.running():self.runtime.suspend('MANUAL_KILL');self.state='STOPPING'
   for rid in result.get('confirmed',[]):self.db.execute("UPDATE receipts SET confirmed=1 WHERE id=? AND status!='PROCESSING'",(rid,))
   selection=result['selection']
   if selection['revision']!=self.revision or selection['skillId']!=self.active:
    if not self.running() and not self.recovery:
     if selection['skillId'] is None:
      self.active=None;self.revision=selection['revision'];self.state='OFF';self.reason=None
     elif selection['sha256']==APPROVED_HASH:
      try:self.runtime.activate(APPROVED_HASH)
      except Exception:self.state='BLOCKED';self.reason='ENGINE_FINGERPRINT_MISMATCH'
      else:self.active=selection['skillId'];self.revision=selection['revision'];self.state='READY';self.reason=None
     else:self.state='BLOCKED';self.reason='SKILL_ADAPTER_NOT_APPROVED'
   for command in result.get('commands',[]):self.command(command)
 def command(self,c):
  rid=str(uuid.UUID(c['requestId']));raw=json.dumps(c,sort_keys=True)
  # Durable PROCESSING precedes any engine operation. Retries never launch twice.
  old=self.db.execute('SELECT payload FROM receipts WHERE id=?',(rid,)).fetchone()
  if old:return
  self.db.execute('INSERT INTO receipts(id,payload,status) VALUES(?,?,?)',(rid,raw,'PROCESSING'))
  if type(c.get('expiresMs')) is not int or self.clock()*1000>=c['expiresMs']:
   self.acknowledge(rid,'REJECTED','COMMAND_EXPIRED');return
  if c['action'] in ('PAUSE','STOP'):
   if self.recovery:self.acknowledge(rid,'REJECTED','RECOVERY_REQUIRED');return
   self.mode=c['action']
   if self.running():
    self.runtime.suspend('OPERATOR_'+c['action']);self.state='PAUSING' if self.mode=='PAUSE' else 'STOPPING'
   else:self.state='PAUSED' if self.mode=='PAUSE' else 'STOPPED'
   self.acknowledge(rid,'APPLIED');return
  if c['action']!='START' or self.kill or self.recovery or self.running() or self.state not in ('READY','PAUSED','STOPPED'):
   self.acknowledge(rid,'REJECTED','ENGINE_NOT_READY');return
  if not self.active or (c['skillId'],c['sha256'],c['revision'])!=(self.active,APPROVED_HASH,self.revision):
   self.acknowledge(rid,'REJECTED','SKILL_ENGINE_ACK_MISMATCH');return
  if type(c.get('targetCycles')) is not int or not 1<=c['targetCycles']<=10:
   self.acknowledge(rid,'REJECTED','BOUNDED_DEMO_REQUIRED');return
  try:
   self.runtime.activate(APPROVED_HASH)
   checks,blockers=self.runtime.preflight()
   if blockers or not all(checks.get(k) is True for k in CHECKS):raise ValueError('PREFLIGHT_FAILED')
  except Exception:self.acknowledge(rid,'REJECTED','PREFLIGHT_FAILED');return
  self.state='STARTING';self.mode=None;self.reason=None
  self.db.execute('UPDATE active_run SET request_id=? WHERE singleton=1',(rid,))
  self.runtime.prepare()
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
     if flat is not True:self.recovery=True;self.state='RECOVERY_REQUIRED';self.reason='BROKER_FLAT_UNCONFIRMED'
     else:
      self.db.execute('UPDATE active_run SET request_id=NULL WHERE singleton=1')
      self.state='PAUSED' if self.mode=='PAUSE' else 'STOPPED'
    if not started:self.acknowledge(rid,'REJECTED','ENTRY_NOT_STARTED')
   except Exception:
    with self.lock:self.recovery=True;self.state='RECOVERY_REQUIRED';self.reason='ENGINE_RECOVERY_REQUIRED'
    if not started:self.acknowledge(rid,'UNCERTAIN','ENGINE_START_UNCONFIRMED')
  self.thread=threading.Thread(target=execute,daemon=False);self.thread.start()
 def disconnected(self):
  with self.lock:
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
