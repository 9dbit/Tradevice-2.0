import json,tempfile,unittest
from pathlib import Path
from email.utils import formatdate
from urllib.error import HTTPError
from v51_forexfactory_calendar import collect,MIN_REFRESH_MS,read_cache,URL
from v51_news_guard import evaluate_calendar,MAX_CALENDAR_AGE_MS
from v51_runtime_calendar import RuntimeCalendar
NOW=1791994800000
class ScheduleCache(unittest.TestCase):
 def setup(self,tmp):
  d=Path(tmp)/'calendar';d.mkdir();(d.parent/'demo_bridge.secret').write_text('a'*64)
  self.clock=NOW;self.calls=0
  def transport():
   self.calls+=1
   from datetime import datetime,timezone
   rows=[dict(title='Boundary',country='JPY',impact='Low',date=datetime.fromtimestamp((NOW-86400000)/1000,timezone.utc).isoformat()),dict(title='News',country='USD',impact='High',date=datetime.fromtimestamp((NOW+7200000)/1000,timezone.utc).isoformat()),dict(title='End',country='CAD',impact='Low',date=datetime.fromtimestamp((NOW+3*86400000)/1000,timezone.utc).isoformat())]
   h={'Content-Type':'application/json','Date':formatdate(self.clock/1000,usegmt=True),'Last-Modified':formatdate(NOW/1000,usegmt=True)}
   return json.dumps(rows).encode(),h
  self.transport=transport;return d
 def test_four_fetches_per_day_restart_reuse_and_continuous_blackout(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp)
   for hour in range(24):
    self.clock=NOW+hour*3600000
    v=collect(d,transport=self.transport,clock=lambda:self.clock)
    self.assertNotIn('error',v)
    self.assertEqual(v['decision']['status'],'BLACKOUT' if 1<=hour<=3 else 'CLEAR')
   self.assertEqual(self.calls,4)
 def test_refresh_inflight_keeps_unexpired_evidence(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp)
   runtime=RuntimeCalendar(collector=lambda *a,**kw:collect(d,transport=self.transport,clock=lambda:self.clock),clock=lambda:self.clock,directory=d)
   runtime.refresh();self.clock+=MIN_REFRESH_MS
   self.assertEqual(runtime.decision()['status'],'CLEAR')
   self.assertEqual(runtime.export()['calendar']['observed_utc_ms'],NOW)
   self.clock=NOW+MAX_CALENDAR_AGE_MS+1
   self.assertEqual(runtime.decision()['status'],'UNKNOWN')
 def test_tampering_and_expiry_cannot_restore_trust(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp);collect(d,transport=self.transport,clock=lambda:self.clock)
   self.assertIsNone(read_cache(d,NOW+MAX_CALENDAR_AGE_MS+1))
   p=d/'trusted_cache.json';v=json.loads(p.read_text());v['payload']['calendar']['events']=[];p.write_text(json.dumps(v))
   self.assertIsNone(read_cache(d,NOW))
   v=collect(d,transport=self.transport,clock=lambda:self.clock)
   self.assertEqual(v['error'],'REFRESH_COOLDOWN');self.assertEqual(self.calls,1)
 def test_429_invalidates_cache_and_honors_longer_retry_after(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp);collect(d,transport=self.transport,clock=lambda:self.clock);self.clock+=MIN_REFRESH_MS
   def failed():raise HTTPError(URL,429,'rate limit',{'Retry-After':'86400'},None)
   v=collect(d,transport=failed,clock=lambda:self.clock)
   self.assertEqual(v['next_fetch_utc_ms'],self.clock+86400000)
   self.assertFalse((d/'trusted_cache.json').exists())
   self.assertEqual(v['error'],'HTTP_429')
if __name__=='__main__':unittest.main()
