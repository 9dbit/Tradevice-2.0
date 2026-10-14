import importlib.util,json,sqlite3,threading,time,uuid
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('demo_bridge',Path(__file__).with_name('bridge.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class Runtime:
 def __init__(self):self.started=0;self.loaded=0;self.stop=threading.Event();self.entered=threading.Event();self.good=True;self.reason=None
 def preflight(self):return {k:self.good for k in b.CHECKS},[]
 def checks(self):return self.preflight()[0]
 def activate(self,h):assert h==b.APPROVED_HASH;self.loaded+=1
 def prepare(self):self.stop.clear()
 def suspend(self,r):self.reason=r
 def run(self,rid,n,ready,expires):self.started+=1;ready();self.entered.set();self.stop.wait(3);return True

def setup(tmp_path):
 r=Runtime();c=b.Controller(tmp_path/'state.db',r);skill=str(uuid.uuid4())
 c.received(dict(killSwitch=False,selection=dict(skillId=skill,revision=1,sha256=b.APPROVED_HASH),commands=[],confirmed=[]))
 return c,r,skill

def cmd(skill,action='START',**patch):return dict(requestId=str(uuid.uuid4()),action=action,targetCycles=1 if action=='START' else None,skillId=skill,sha256=b.APPROVED_HASH,revision=1,expiresMs=int(time.time()*1000)+60000,**patch)
def invoke(c,x):
 with c.lock:c.command(x)
def finish(c,r):r.stop.set();c.thread.join(2)
def receipt(c,rid):return c.db.execute('SELECT status,error FROM receipts WHERE id=?',(rid,)).fetchone()

def test_activation_never_starts_orders(tmp_path):
 c,r,s=setup(tmp_path);assert r.loaded==1 and r.started==0 and c.state=='READY';assert c.snapshot()['activeSkillId']==s

def test_single_start_duplicate_and_flat_completion(tmp_path):
 c,r,s=setup(tmp_path);x=cmd(s);invoke(c,x);assert r.entered.wait(1);invoke(c,x)
 assert r.started==1 and receipt(c,x['requestId'])[0]=='APPLIED'
 finish(c,r);assert c.state=='STOPPED';assert c.db.execute('SELECT request_id FROM active_run').fetchone()[0] is None

@pytest.mark.parametrize('patch',[dict(targetCycles=0),dict(targetCycles=11),dict(targetCycles=True),dict(skillId=str(uuid.uuid4())),dict(sha256='a'*64),dict(revision=2),dict(expiresMs=0)])
def test_invalid_start_never_runs(tmp_path,patch):
 c,r,s=setup(tmp_path);x=cmd(s)|patch;invoke(c,x);assert r.started==0;assert receipt(c,x['requestId'])[0]=='REJECTED'

def test_guard_failure_never_runs(tmp_path):
 c,r,s=setup(tmp_path);r.good=False;x=cmd(s);invoke(c,x);assert r.started==0;assert receipt(c,x['requestId'])[1]=='PREFLIGHT_FAILED'

@pytest.mark.parametrize('action,state,done',[('PAUSE','PAUSING','PAUSED'),('STOP','STOPPING','STOPPED')])
def test_pause_stop_keeps_supervision_until_flat(tmp_path,action,state,done):
 c,r,s=setup(tmp_path);invoke(c,cmd(s));assert r.entered.wait(1)
 invoke(c,cmd(s,action));assert c.state==state and c.running() and r.reason=='OPERATOR_'+action
 finish(c,r);assert c.state==done

def test_reconnect_does_not_resume_and_disconnect_suspends(tmp_path):
 c,r,s=setup(tmp_path);invoke(c,cmd(s));assert r.entered.wait(1);c.last_ok=time.time()-11;c.disconnected()
 assert r.reason=='BRIDGE_CONNECTION_LOST' and c.running()
 c.received(dict(killSwitch=False,selection=dict(skillId=s,revision=1,sha256=b.APPROVED_HASH),commands=[],confirmed=[]))
 assert r.reason=='BRIDGE_CONNECTION_LOST';finish(c,r)

def test_restart_after_ack_blocks_new_start(tmp_path):
 c,r,s=setup(tmp_path);x=cmd(s);invoke(c,x);assert r.entered.wait(1)
 other=b.Controller(tmp_path/'state.db',Runtime());assert other.recovery and other.state=='RECOVERY_REQUIRED'
 invoke(other,x);assert other.runtime.started==0
 finish(c,r)

def test_restart_during_dispatch_is_uncertain_not_resent(tmp_path):
 c,r,s=setup(tmp_path);x=cmd(s);c.db.execute('INSERT INTO receipts(id,payload,status) VALUES(?,?,?)',(x['requestId'],json.dumps(x),'PROCESSING'))
 other=b.Controller(tmp_path/'state.db',Runtime());invoke(other,x)
 assert other.recovery and receipt(other,x['requestId'])[0]=='UNCERTAIN' and other.runtime.started==0

def test_second_start_during_run_rejected(tmp_path):
 c,r,s=setup(tmp_path);invoke(c,cmd(s));assert r.entered.wait(1);x=cmd(s);invoke(c,x)
 assert receipt(c,x['requestId'])[0]=='REJECTED' and r.started==1;finish(c,r)

def test_lock_refuses_second_controller_process(tmp_path):
 with b.ProcessLock(tmp_path/'lock'):
  with pytest.raises(OSError):
   with b.ProcessLock(tmp_path/'lock'):pass

def test_kill_switch_vetoes_start_and_keeps_active_supervision(tmp_path):
 c,r,s=setup(tmp_path);c.received(dict(killSwitch=True,selection=dict(skillId=s,revision=1,sha256=b.APPROVED_HASH),commands=[],confirmed=[]))
 x=cmd(s);invoke(c,x);assert receipt(c,x['requestId'])[0]=='REJECTED' and r.started==0
 c.kill=False;invoke(c,cmd(s));assert r.entered.wait(1)
 c.received(dict(killSwitch=True,selection=dict(skillId=s,revision=1,sha256=b.APPROVED_HASH),commands=[],confirmed=[]))
 assert r.reason=='MANUAL_KILL' and c.running();finish(c,r)

class Response:
 def __init__(self,stamp,secret,status=200,tampered=False):
  self.status=status;self.body=json.dumps({'serverMs':int(time.time()*1000),'commands':[]}).encode()
  self.signature=b.sign(secret,stamp,self.body) if not tampered else '0'*64
 def read(self,n):return self.body[:n]
 def getheader(self,k,default=''):return self.signature

class Connection:
 def __init__(self,secret,status=200,tampered=False):self.secret=secret;self.status=status;self.tampered=tampered;self.requests=[];self.closed=False
 def request(self,method,path,body,headers):self.requests.append((method,path,body,headers))
 def getresponse(self):return Response(self.requests[-1][3]['x-tradevice-demo-time'],self.secret,self.status,self.tampered)
 def close(self):self.closed=True

def test_heartbeat_reuses_tls_and_authenticates_each_payload():
 secret='a'*64;connections=[]
 def factory(host,timeout):
  assert host=='copy-api-staging-4c33.up.railway.app' and timeout==6
  c=Connection(secret);connections.append(c);return c
 client=b.ExchangeClient(secret,factory)
 for n in (0,1):client.send({'observedMs':int(time.time()*1000)+n,'receipts':[]})
 assert len(connections)==1 and len(connections[0].requests)==2
 for method,path,body,h in connections[0].requests:
  assert method=='POST' and path=='/internal/master/demo/exchange'
  assert h['x-tradevice-demo-signature']==b.sign(secret,h['x-tradevice-demo-time'],body)

@pytest.mark.parametrize('status,tampered',[(302,False),(503,False),(200,True)])
def test_exchange_failure_closes_connection_without_automatic_resend(status,tampered):
 c=Connection('a'*64,status,tampered);client=b.ExchangeClient('a'*64,lambda *a,**k:c)
 with pytest.raises(ValueError):client.send({'observedMs':int(time.time()*1000)})
 assert len(c.requests)==1 and c.closed and client.connection is None

def test_heartbeat_cadence_counts_work_and_respects_rate_limit():
 assert b.heartbeat_delay(.2)==1.3
 assert b.heartbeat_delay(2.5)==.5
