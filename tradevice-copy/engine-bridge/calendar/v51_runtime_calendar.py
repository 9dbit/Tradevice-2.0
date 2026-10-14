"""Nonblocking Forex Factory reader. Startup waits for the durable cooldown.
Only validated HTTPS or HMAC-authenticated unexpired local evidence establishes trust.
"""
import threading,time
from pathlib import Path
from v51_forexfactory_calendar import collect,MIN_REFRESH_MS
from v51_news_guard import evaluate_calendar,MAX_CALENDAR_AGE_MS
REFRESH_PENDING='CALENDAR_REFRESH_PENDING'
FETCH_GRACE_MS=20_000  # Bounded download allowance; never permission to enter.
DIRECTORY=Path(__file__).resolve().parent/'read_only'/'forexfactory_calendar'
class RuntimeCalendar:
    def __init__(self,collector=collect,clock=lambda:int(time.time()*1000),directory=DIRECTORY):
        self.collector,self.clock,self.directory=collector,clock,directory
        self.lock=threading.Lock();self.calendar=None;self.stop=threading.Event();self.thread=None
        self.last_error=None;self.next_fetch_utc_ms=None
        self.verified_response=False;self.provenance=None
    def refresh(self):
        try:result=self.collector(self.directory,clock=self.clock)
        except Exception:result={'error':'FETCH_FAILED'}
        c=result.get('calendar') if not result.get('error') else None
        now=self.clock()
        until=result.get('next_fetch_utc_ms',now+MIN_REFRESH_MS)
        if type(until) is not int:until=now+MIN_REFRESH_MS
        with self.lock:
            self.calendar=c;self.provenance=result.get('provenance') if c else None
            self.last_error=result.get('error');self.next_fetch_utc_ms=until
            self.verified_response=evaluate_calendar(c,now,source_verified=c is not None)['status'] in ('CLEAR','BLACKOUT')
        # Respect the actual durable retry time, rather than adding another five minutes.
        return max(250,until-now)
    def export(self):
        # Only high-impact events affect this policy. Envelope coverage still comes
        # from the complete weekly response, never from the filtered event list.
        with self.lock:
            c=self.calendar;p=self.provenance;error=self.last_error;until=self.next_fetch_utc_ms
            filtered={**c,'events':[e for e in c['events'] if e['impact']=='HIGH']} if c else None
        if filtered and len(filtered['events'])>200:
            filtered=None;p=None;error='EVENT_LIMIT_EXCEEDED'
        return dict(calendar=filtered,provenance=p,error=error,nextFetchAt=until,
                    policyVersion='SCHEDULE_6H_V1')
    def decision(self):
        with self.lock:
            c=self.calendar;error=self.last_error;until=self.next_fetch_utc_ms
            verified=self.verified_response
        now=self.clock()
        d=evaluate_calendar(c,now,source_verified=c is not None)
        if c is not None:
            stamp=c.get('observed_utc_ms')
            d['next_fetch_utc_ms']=until
            if type(stamp) is int:
                d['valid_until_utc_ms']=stamp+MAX_CALENDAR_AGE_MS
                # An expired, formerly verified response can only authorize WAIT.
                # Future timestamps, dead readers and unlimited waits remain fatal.
                worker_ok=self.thread is None or self.thread.is_alive()
                if (verified and not error and worker_ok and not self.stop.is_set()
                        and d['reason']=='CALENDAR_STALE_OR_FUTURE'
                        and now-stamp>MAX_CALENDAR_AGE_MS and type(until) is int
                        and -FETCH_GRACE_MS<=until-now<=MIN_REFRESH_MS):
                    d['reason']=REFRESH_PENDING
                    d['retryable_refresh']=True
        if c is None and error:
            reasons={'REFRESH_COOLDOWN':'CALENDAR_REFRESH_COOLDOWN',
                     'FETCH_ALREADY_LOCKED':'CALENDAR_FETCH_IN_PROGRESS',
                     'HTTP_429':'CALENDAR_HTTP_RATE_LIMIT',
                     'HTTP_503':'CALENDAR_SOURCE_UNAVAILABLE'}
            d['reason']=reasons.get(error,'CALENDAR_FETCH_OR_VALIDATION_FAILED')
            d['fetch_error']=error;d['next_fetch_utc_ms']=until
        return d
    def wait_ready(self,timeout_s=320,*,clock=time.monotonic,sleeper=time.sleep,on_wait=None):
        deadline=clock()+timeout_s
        while True:
            d=self.decision()
            if d['status']!='UNKNOWN':return d
            if d['reason'] not in ('CALENDAR_SOURCE_UNVERIFIED','CALENDAR_REFRESH_COOLDOWN',
                                   'CALENDAR_FETCH_IN_PROGRESS',REFRESH_PENDING):return d
            remaining=deadline-clock()
            if remaining<=0:return d
            if on_wait:on_wait()
            sleeper(min(.25,remaining))
    def start(self):
        def run():
            while not self.stop.is_set():self.stop.wait(self.refresh()/1000)
        self.thread=threading.Thread(target=run,name='v51-news-reader',daemon=True);self.thread.start()
    def close(self):self.stop.set()
