"""Runs on the clone against its existing simulated broker, never MT5."""
import unittest
from test_v51_runtime_news import RuntimeNewsTests
from v51_runtime_calendar import RuntimeCalendar
from v51_news_guard import MAX_CALENDAR_AGE_MS
class ScheduleEngine(RuntimeNewsTests):
 def calendar(self,events=None):
  stamp=int((self.now+1700000000)*1000)
  r=RuntimeCalendar(clock=lambda:int((self.now+1700000000)*1000))
  r.calendar=dict(schema='tradevice.calendar.utc.v1',time_basis='UTC',complete=True,
   observed_utc_ms=stamp,coverage_start_utc_ms=stamp-86400000,coverage_end_utc_ms=stamp+86400000,events=events or [])
  r.verified_response=True;r.next_fetch_utc_ms=stamp+21600000
  self.engine.news_provider=r.decision
  return r
 def test_five_minute_boundary_does_not_retire_recovery_pending(self):
  self.active();r=self.calendar();orders={o.ticket for o in self.api.orders}
  self.assertTrue(orders)
  self.now+=301;self.tick(101.);self.engine.step()
  self.assertFalse(self.engine.state.get('news_entry_suspended'))
  self.assertEqual({o.ticket for o in self.api.orders},orders)
 def test_six_hour_refresh_overlap_preserves_pending_but_expiry_retires(self):
  self.active();r=self.calendar();orders={o.ticket for o in self.api.orders}
  self.now+=21601;self.tick(101.);self.engine.step()
  self.assertEqual({o.ticket for o in self.api.orders},orders)
  self.assertFalse(self.engine.state.get('news_entry_suspended'))
  self.now+=(MAX_CALENDAR_AGE_MS/1000)-21601+1;self.tick(101.);self.engine.step()
  self.assertTrue(self.engine.state.get('news_entry_suspended'));self.assertFalse(self.api.orders)
 def test_cached_schedule_enters_blackout_without_new_download(self):
  self.active();stamp=int((self.now+1700000000)*1000)
  self.calendar([dict(id='test',impact='HIGH',scheduled_utc_ms=stamp+3601000,time_confirmed=True)])
  self.now+=1;self.tick(101.);self.engine.step()
  self.assertTrue(self.engine.state.get('news_entry_suspended'));self.assertFalse(self.api.orders)
if __name__=='__main__':unittest.main()
