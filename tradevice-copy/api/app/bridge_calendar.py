"""Calendar evidence from the authenticated, replay-checked PC bridge.
No outbound calendar requests. Schedule age and bridge freshness are distinct.
"""
import re
from .news_calendar import NewsCalendar, URL

BRIDGE_MAX_AGE_MS=15_000
POLICY='SCHEDULE_6H_V1'

def validate_evidence(value, now):
    if value is None:return
    if not isinstance(value,dict) or set(value)!={'calendar','provenance','error','nextFetchAt','policyVersion'}:
        raise ValueError('CALENDAR_EVIDENCE_INVALID')
    if value['policyVersion']!=POLICY:raise ValueError('CALENDAR_POLICY_INVALID')
    until=value['nextFetchAt'];error=value['error']
    if until is not None and (type(until) is not int or until<0):raise ValueError('CALENDAR_REFRESH_INVALID')
    if error is not None and (not isinstance(error,str) or not re.fullmatch('[A-Z0-9_]{1,100}',error)):
        raise ValueError('CALENDAR_ERROR_INVALID')
    c,p=value['calendar'],value['provenance']
    if c is None:
        if p is not None:raise ValueError('CALENDAR_PROVENANCE_INVALID')
        return
    if error is not None or not isinstance(c,dict) or not isinstance(p,dict):raise ValueError('CALENDAR_EVIDENCE_INVALID')
    if p.get('provider')!='Forex Factory' or p.get('url')!=URL or not re.fullmatch('[a-f0-9]{64}',str(p.get('sha256',''))):
        raise ValueError('CALENDAR_PROVENANCE_INVALID')
    if c.get('schema')!='tradevice.calendar.utc.v1' or c.get('complete') is not True or c.get('time_basis')!='UTC':
        raise ValueError('CALENDAR_SCHEMA_INVALID')
    for k in ('observed_utc_ms','coverage_start_utc_ms','coverage_end_utc_ms'):
        if type(c.get(k)) is not int or c[k]<0:raise ValueError('CALENDAR_TIMESTAMP_INVALID')
    for k in ('retrieved_utc_ms','http_date_utc_ms','last_modified_utc_ms','age_ms'):
        if type(p.get(k)) is not int or p[k]<0:raise ValueError('CALENDAR_PROVENANCE_INVALID')
    if (p['retrieved_utc_ms']>now+1000 or not 0<=p['age_ms']<=300000 or
        not -1000<=p['retrieved_utc_ms']-p['http_date_utc_ms']<=300000 or
        p['last_modified_utc_ms']>p['http_date_utc_ms']+1000 or
        c['observed_utc_ms']!=min(p['retrieved_utc_ms'],p['http_date_utc_ms'])-p['age_ms']):
        raise ValueError('CALENDAR_PROVENANCE_INVALID')
    if not 0<=c['coverage_end_utc_ms']-c['coverage_start_utc_ms']<=8*86400000:
        raise ValueError('CALENDAR_COVERAGE_INVALID')
    events=c.get('events')
    if not isinstance(events,list) or len(events)>200:raise ValueError('CALENDAR_EVENTS_INVALID')
    ids=set()
    for e in events:
        if not isinstance(e,dict):raise ValueError('CALENDAR_EVENT_INVALID')
        if any(not isinstance(e.get(k),str) or not 0<len(e[k])<=limit for k,limit in [('id',80),('title',300),('currency',16)]):
            raise ValueError('CALENDAR_EVENT_INVALID')
        if e['id'] in ids or e.get('impact')!='HIGH' or e.get('time_confirmed') is not True:
            raise ValueError('CALENDAR_EVENT_INVALID')
        ids.add(e['id'])
        if type(e.get('scheduled_utc_ms')) is not int or not c['coverage_start_utc_ms']<=e['scheduled_utc_ms']<=c['coverage_end_utc_ms']:
            raise ValueError('CALENDAR_EVENT_INVALID')

class BridgeCalendar(NewsCalendar):
    def __init__(self,**kwargs):
        super().__init__(**kwargs)
        self.bridge_observed=None
    def start(self):pass  # The PC is the only network collector.
    def accept(self,value,stamp):
        validate_evidence(value,self.clock())
        with self.lock:
            if self.bridge_observed is not None and stamp<=self.bridge_observed:return
            self.bridge_observed=stamp
            self.calendar=value.get('calendar') if value else None
            self.provenance=value.get('provenance') if value else None
            self.error=('CALENDAR_'+value['error']) if value and value.get('error') else None
            if self.calendar is None:self.error=self.error or 'CALENDAR_NOT_CONNECTED'
            self.next_fetch=(value.get('nextFetchAt') or 0) if value else 0
    def projection(self,now=None):
        now=self.clock() if now is None else now
        with self.lock:
            stamp=self.bridge_observed
            # The inherited projection uses the same lock; it is called outside it.
        view=super().projection(now)
        view.update(policyVersion=POLICY,bridgeObservedAt=stamp,refreshIntervalHours=6)
        if stamp is None or not -1000<=now-stamp<=BRIDGE_MAX_AGE_MS:
            view.update(status='UNKNOWN',reason='CALENDAR_BRIDGE_STALE',entriesAllowed=False,
                        nextEvent=None,highImpactEvents=[],blackoutUntil=None)
        return view
