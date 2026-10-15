"""Controller only: no MT5 imports or broker execution."""
import json,time,threading,uuid
import pytest
from test_bridge import Runtime,b,cmd,invoke,receipt
from emergency_state import begin,read,requested,update,EmergencyHandoff
class ClosingRuntime(Runtime):
 def __init__(self,root):super().__init__();self.root=root;self.closes=0;self.fail=False
 def begin_emergency(self,rid,expires):return begin(self.root,rid,expires)
 def emergency_snapshot(self):return read(self.root)
 def suspend(self,reason):super().suspend(reason);self.stop.set()
 def emergency_failed(self,code):update(self.root,'RECONCILIATION_REQUIRED')
 def emergency_close(self,rid,expires,prior):
  self.closes+=1
  if self.fail:raise ValueError('EMERGENCY_FLAT_UNCONFIRMED')
  update(self.root,'COMPLETE',0,0);return {'broker_flat':True}
def make(tmp_path):
 r=ClosingRuntime(tmp_path);c=b.Controller(tmp_path/'state.db',r);return c,r

def test_emergency_ignores_entry_kill_news_and_recovery_but_never_starts(tmp_path):
 c,r=make(tmp_path);c.kill=True;c.recovery=True;r.good=False
 x=cmd(None,'EMERGENCY_CLOSE',confirmClose=True);invoke(c,x);c.emergency_thread.join(2)
 assert receipt(c,x['requestId'])==('APPLIED',None) and r.closes==1 and r.started==0
 assert c.state=='STOPPED' and not c.recovery and not requested(tmp_path)
 invoke(c,x);assert r.closes==1

def test_active_runner_releases_before_close_and_does_not_resume(tmp_path):
 c,r=make(tmp_path);s=str(uuid.uuid4());c.kill=False;c.active=s;c.revision=1;c.state='READY'
 start=cmd(s);invoke(c,start);assert r.entered.wait(1)
 x=cmd(None,'EMERGENCY_CLOSE',confirmClose=True);invoke(c,x);c.emergency_thread.join(2)
 assert not c.running() and r.closes==1 and r.started==1
 assert c.db.execute('SELECT request_id FROM active_run').fetchone()[0] is None
 assert receipt(c,x['requestId'])[0]=='APPLIED'

@pytest.mark.parametrize('patch',[dict(confirmClose=False),dict(expiresMs=0)])
def test_unconfirmed_or_expired_does_not_close(tmp_path,patch):
 c,r=make(tmp_path);x=cmd(None,'EMERGENCY_CLOSE',confirmClose=True)|patch;invoke(c,x)
 assert r.closes==0 and receipt(c,x['requestId'])[0]=='REJECTED'

def test_failed_close_keeps_latch_and_active_pointer(tmp_path):
 c,r=make(tmp_path);r.fail=True;prior=str(uuid.uuid4());c.db.execute('UPDATE active_run SET request_id=?',(prior,))
 x=cmd(None,'EMERGENCY_CLOSE',confirmClose=True);invoke(c,x);c.emergency_thread.join(2)
 assert c.recovery and requested(tmp_path) and receipt(c,x['requestId'])[0]=='UNCERTAIN'
 assert c.db.execute('SELECT request_id FROM active_run').fetchone()[0]==prior
 other=b.Controller(tmp_path/'state.db',r);invoke(other,x);assert r.closes==1 and other.recovery
 r.fail=False;y=cmd(None,'EMERGENCY_CLOSE',confirmClose=True);invoke(other,y);other.emergency_thread.join(2)
 assert receipt(other,x['requestId'])==('APPLIED',None) and not other.recovery
 assert other.db.execute('SELECT confirmed FROM receipts WHERE id=?',(x['requestId'],)).fetchone()[0]==0

def test_same_exchange_never_starts_even_if_emergency_finishes_fast(tmp_path):
 c,r=make(tmp_path);s=str(uuid.uuid4());start=cmd(s);close=cmd(s,'EMERGENCY_CLOSE',confirmClose=True)
 c.received(dict(killSwitch=False,selection=dict(skillId=s,revision=1,sha256=b.APPROVED_HASH),commands=[start,close]))
 c.emergency_thread.join(2)
 assert r.started==0 and r.closes==1 and receipt(c,start['requestId'])[1]=='EMERGENCY_SUPERSEDED'

def test_unrelated_uncertain_receipt_is_not_erased(tmp_path):
 c,r=make(tmp_path);prior=cmd(None)
 c.db.execute("INSERT INTO receipts(id,payload,status) VALUES(?,?,'UNCERTAIN')",(prior['requestId'],json.dumps(prior)))
 close=cmd(None,'EMERGENCY_CLOSE',confirmClose=True);invoke(c,close);c.emergency_thread.join(2)
 assert c.recovery and receipt(c,prior['requestId'])[0]=='UNCERTAIN'

def test_hung_runner_does_not_steal_execution(tmp_path):
 c,r=make(tmp_path);c.trade_running=lambda:True;c.clock=lambda:time.time()+60
 x=cmd(None,'EMERGENCY_CLOSE',confirmClose=True);x['expiresMs']=int((time.time()+61)*1000)
 invoke(c,x);c.clock=lambda:time.time()+62;c.emergency_thread.join(2)
 assert r.closes==0 and c.recovery and receipt(c,x['requestId'])[0]=='UNCERTAIN'

def test_invalid_intent_fails_closed(tmp_path):
 path=tmp_path/'read_only/emergency_close.json';path.parent.mkdir();path.write_text('{}')
 with pytest.raises(ValueError):requested(tmp_path)
