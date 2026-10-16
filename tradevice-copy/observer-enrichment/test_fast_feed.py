"""Synthetic cadence/transport tests; no MT5, network or credentials."""
import importlib.util,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).parent

def module(name,stubs):
 with patch.dict(sys.modules,stubs):
  spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class Tests(unittest.TestCase):
 def test_work_time_is_included_in_half_second_cadence(self):
  p=types.ModuleType('goldtrap_arc.persistence');p.atomic_json=lambda *a:None
  m=module('v51_observer_service',{'goldtrap_arc':types.ModuleType('goldtrap_arc'),'goldtrap_arc.persistence':p})
  clock=[0.];starts=[];outputs=[]
  def send(*a,**k):starts.append(clock[0]);clock[0]+=.2;return {'status':'ACCEPTED_READ_ONLY'}
  m.observer_loop(None,None,sender=send,status_writer=outputs.append,stop_requested=lambda:len(starts)>=3,sleeper=lambda n:clock.__setitem__(0,clock[0]+n),monotonic=lambda:clock[0],now_ms=lambda:int(clock[0]*1000))
  self.assertEqual(starts,[0.,.5,1.]);self.assertEqual(outputs[0]['cycle_duration_ms'],200)
 def test_connection_reused_and_failed_exchange_not_replayed(self):
  snap=types.ModuleType('v51_mt5_readonly_snapshot');snap.capture=lambda *a:None
  m=module('v51_staging_readonly_forwarder',{'v51_mt5_readonly_snapshot':snap})
  class Connection:
   requests=0;closed=False;fail=False
   def request(self,*a):
    self.requests+=1
    if self.fail:raise OSError('synthetic')
   def getresponse(self):return types.SimpleNamespace(status=202)
   def close(self):self.closed=True
  c=Connection();factories=[]
  client=m.PersistentClient(factory=lambda *a,**k:factories.append(1) or c)
  req=m.urllib.request.Request(m.ENDPOINT,b'{}')
  client.open(req);client.open(req);self.assertEqual(len(factories),1)
  c.fail=True
  with self.assertRaises(OSError):client.open(req)
  self.assertEqual(c.requests,3);self.assertTrue(c.closed);self.assertIsNone(client.connection)
  with self.assertRaises(ValueError):m.PersistentClient(endpoint='https://example.invalid')
if __name__=='__main__':unittest.main()
