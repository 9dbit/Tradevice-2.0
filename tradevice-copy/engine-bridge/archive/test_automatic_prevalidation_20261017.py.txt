import time,threading
import pytest
from test_bridge import setup,cmd,invoke,receipt,b,Runtime

def arm(c,s):
 x=cmd(s)|dict(cycleMode='AUTOMATIC',targetCycles=None)
 invoke(c,x);return x

def until(predicate):
 end=time.monotonic()+3
 while not predicate() and time.monotonic()<end:time.sleep(.01)
 assert predicate()

def stop(c,r,s):
 invoke(c,cmd(s,'STOP'));r.stop.set();c.thread.join(3);assert not c.running()

def test_auto_arms_while_blocked_then_runs_once_checks_pass(tmp_path):
 c,r,s=setup(tmp_path);r.good=False;x=arm(c,s)
 until(lambda:bool(c.auto_blockers))
 assert receipt(c,x['requestId'])==('APPLIED',None)
 assert r.started==0 and c.state=='AUTO_WAITING'
 assert c.snapshot()['automatic']['enabled']
 r.good=True;until(lambda:r.started==1)
 stop(c,r,s);assert not c.automatic and c.state=='STOPPED'

def test_auto_rechecks_all_checks_between_cycles_and_unique_children(tmp_path):
 c,r,s=setup(tmp_path);ids=[]
 def run(rid,n,ready,expires):
  ids.append(rid);assert n==1;ready();r.last_cycle_completed=True;r.good=False;return True
 r.run=run;arm(c,s);until(lambda:len(ids)==1 and c.auto_completed==1)
 until(lambda:c.state=='AUTO_WAITING' and bool(c.auto_blockers))
 assert len(ids)==1
 r.good=True;until(lambda:len(ids)==2)
 assert ids[0]!=ids[1];stop(c,r,s)

@pytest.mark.parametrize('key',b.CHECKS)
def test_any_failed_check_blocks_auto_entry(tmp_path,key):
 c,r,s=setup(tmp_path)
 r.preflight=lambda settings=None:({k:k!=key for k in b.CHECKS},[])
 arm(c,s);until(lambda:bool(c.auto_blockers))
 assert r.started==0;stop(c,r,s)

@pytest.mark.parametrize('action,state',[('PAUSE','PAUSED'),('STOP','STOPPED')])
def test_cancel_waiting_does_not_enter_when_checks_recover(tmp_path,action,state):
 c,r,s=setup(tmp_path);r.good=False;arm(c,s)
 until(lambda:bool(c.auto_blockers));invoke(c,cmd(s,action));c.thread.join(2)
 r.good=True;assert not c.running() and not c.automatic and c.state==state and r.started==0

def test_duplicate_arm_does_not_spawn_second_loop(tmp_path):
 c,r,s=setup(tmp_path);r.good=False;x=arm(c,s);thread=c.thread;invoke(c,x)
 assert c.thread is thread;stop(c,r,s)

def test_restart_does_not_restore_waiting_automatic(tmp_path):
 c,r,s=setup(tmp_path);r.good=False;arm(c,s);until(lambda:bool(c.auto_blockers))
 other=b.Controller(tmp_path/'state.db',Runtime())
 assert not other.automatic and not other.running();stop(c,r,s)

def test_risk_stop_disarms_even_when_flat(tmp_path):
 c,r,s=setup(tmp_path)
 r.run=lambda *args:'RISK_STOP_FLAT'
 arm(c,s);c.thread.join(2)
 assert not c.automatic and c.state=='STOPPED' and c.reason=='AUTOMATIC_RISK_STOP'
 assert c.db.execute('SELECT request_id FROM active_run').fetchone()[0] is None

def test_unconfirmed_cycle_disarms_and_preserves_recovery_pointer(tmp_path):
 c,r,s=setup(tmp_path);r.run=lambda *args:False
 arm(c,s);c.thread.join(2)
 assert c.recovery and not c.automatic and c.state=='RECOVERY_REQUIRED'
 assert c.db.execute('SELECT request_id FROM active_run').fetchone()[0]

@pytest.mark.parametrize('cause',['disconnect','kill','selection'])
def test_control_failure_disarms_waiting_auto(tmp_path,cause):
 c,r,s=setup(tmp_path);r.good=False;arm(c,s);until(lambda:bool(c.auto_blockers))
 if cause=='disconnect':c.last_ok=time.time()-11;c.disconnected()
 else:c.received(dict(killSwitch=cause=='kill',selection=dict(skillId=s,revision=2 if cause=='selection' else 1,sha256=b.APPROVED_HASH),commands=[],confirmed=[]))
 c.thread.join(2);assert not c.automatic and not c.running() and r.started==0

def test_stop_during_preflight_cannot_be_cleared_by_prepare(tmp_path):
 c,r,s=setup(tmp_path);entered=threading.Event();release=threading.Event()
 def preflight(settings=None):entered.set();release.wait(2);return {k:True for k in b.CHECKS},[]
 r.preflight=preflight;arm(c,s);assert entered.wait(1)
 invoke(c,cmd(s,'STOP'));release.set();c.thread.join(2)
 assert r.started==0 and not c.automatic
