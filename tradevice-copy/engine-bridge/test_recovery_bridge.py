import json,tempfile,time,unittest,uuid
from pathlib import Path
import bridge
class Runtime:
 def __init__(self):self.started=0;self.result='RISK_STOP_FLAT'
 def preflight(self):return {k:True for k in bridge.CHECKS},[]
 def checks(self):return self.preflight()[0]
 def activate(self,h):pass
 def prepare(self):pass
 def run(self,rid,n,ready,expires):
  self.started+=1;ready()
  if isinstance(self.result,Exception):raise self.result
  return self.result
class RecoveryBridge(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.r=Runtime();self.c=bridge.Controller(Path(self.tmp.name)/'state.db',self.r);self.addCleanup(self.c.db.close);self.skill=str(uuid.uuid4())
  self.c.received(dict(killSwitch=False,selection=dict(skillId=self.skill,sha256=bridge.APPROVED_HASH,revision=1),commands=[],confirmed=[]))
  self.cmd=dict(requestId=str(uuid.uuid4()),action='START',targetCycles=10,skillId=self.skill,sha256=bridge.APPROVED_HASH,revision=1,expiresMs=int(time.time()*1000)+60000)
 def run_once(self):
  with self.c.lock:self.c.command(self.cmd)
  self.c.thread.join(2);self.assertFalse(self.c.running())
 def test_risk_stop_does_not_start_next_cycle(self):
  self.run_once();self.assertEqual(self.c.state,'STOPPED');self.assertFalse(self.c.recovery);self.assertEqual(self.r.started,1)
  self.assertIsNone(self.c.db.execute('select request_id from active_run').fetchone()[0])
  with self.c.lock:self.c.command(self.cmd)
  self.assertEqual(self.r.started,1)
 def test_unexpected_error_stays_blocked(self):
  self.r.result=RuntimeError('test');self.run_once();self.assertTrue(self.c.recovery)
  snap=self.c.snapshot();self.assertFalse(snap['checks']['reconciled']);self.assertEqual(snap['blockers'],['ENGINE_RECOVERY_REQUIRED'])
  self.assertEqual(self.c.db.execute('select request_id from active_run').fetchone()[0],self.cmd['requestId'])
 def test_unproved_flat_blocks(self):
  self.r.result=False;self.run_once();self.assertTrue(self.c.recovery)
 def test_unknown_return_blocks(self):
  self.r.result='STOPPED';self.run_once();self.assertTrue(self.c.recovery)
 def test_normal_completion_unchanged(self):
  self.r.result=True;self.run_once();self.assertEqual(self.c.state,'STOPPED')
 def test_restart_preserves_unresolved_block(self):
  self.r.result=False;self.run_once();other=bridge.Controller(Path(self.tmp.name)/'state.db',Runtime());self.addCleanup(other.db.close)
  self.assertTrue(other.recovery);self.assertFalse(other.snapshot()['checks']['reconciled'])
if __name__=='__main__':unittest.main()
