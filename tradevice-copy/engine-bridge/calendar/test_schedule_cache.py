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
 def test_lock_contention_reuses_signed_cache_without_fetch_or_timestamp_renewal(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp);original=collect(d,transport=self.transport,clock=lambda:self.clock)
   self.clock+=1000;(d/'fetch.lock').write_text('owner')
   runtime=RuntimeCalendar(collector=lambda *a,**kw:collect(d,transport=self.transport,clock=lambda:self.clock),clock=lambda:self.clock,directory=d)
   self.assertEqual(runtime.refresh(),5000)
   self.assertEqual(runtime.decision()['status'],'CLEAR')
   self.assertEqual(runtime.export()['calendar']['observed_utc_ms'],original['calendar']['observed_utc_ms'])
   self.assertEqual(self.calls,1);self.assertEqual((d/'fetch.lock').read_text(),'owner')
   (d/'fetch.lock').unlink();runtime.refresh();self.assertEqual(self.calls,1)
 def test_lock_without_valid_cache_retries_locally_and_stays_unknown(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp);(d/'fetch.lock').write_text('owner')
   runtime=RuntimeCalendar(collector=lambda *a,**kw:collect(d,transport=self.transport,clock=lambda:self.clock),clock=lambda:self.clock,directory=d)
   self.assertEqual(runtime.refresh(),5000);self.assertEqual(runtime.decision()['status'],'UNKNOWN')
   self.assertEqual(self.calls,0);self.assertTrue((d/'fetch.lock').exists())
 def test_lock_does_not_reuse_expired_cache(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp);collect(d,transport=self.transport,clock=lambda:self.clock)
   self.clock+=MAX_CALENDAR_AGE_MS+1;(d/'fetch.lock').write_text('owner')
   v=collect(d,transport=self.transport,clock=lambda:self.clock)
   self.assertEqual(v['error'],'FETCH_ALREADY_LOCKED');self.assertNotIn('calendar',v);self.assertEqual(self.calls,1)
 def test_lock_keeps_blackout_enforced(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=self.setup(tmp);collect(d,transport=self.transport,clock=lambda:self.clock)
   self.clock+=3600000;(d/'fetch.lock').write_text('owner')
   v=collect(d,transport=self.transport,clock=lambda:self.clock)
   self.assertEqual(v['decision']['status'],'BLACKOUT');self.assertFalse(v['decision']['entries_allowed']);self.assertEqual(self.calls,1)
if __name__=='__main__':unittest.main()
