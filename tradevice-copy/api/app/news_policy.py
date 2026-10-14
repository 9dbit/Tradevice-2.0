"""Research admission policy. No IO or broker calls. All times UTC milliseconds.
Transport/source verification belongs to the caller, never to a payload flag.
"""
HOUR_MS=3_600_000
MAX_CALENDAR_AGE_MS=22_200_000  # 6h + 10m bounded refresh overlap; schedule age, not quote age.

def evaluate_calendar(calendar,now_ms,*,source_verified=False):
    def result(status,reason,until=None,ids=()):
        return dict(policy='AVOID_HIGH_IMPACT_60M_BEFORE_60M_AFTER',status=status,
            reason=reason,entries_allowed=status=='CLEAR',supervise_existing_basket=True,
            retire_pending_entries=status!='CLEAR',blackout_until_utc_ms=until,
            matching_event_ids=list(ids),before_minutes=60,after_minutes=60,
            order_dispatch_authorized=False)
    if type(now_ms) is not int or now_ms<0:return result('UNKNOWN','INVALID_CLOCK')
    if source_verified is not True:return result('UNKNOWN','CALENDAR_SOURCE_UNVERIFIED')
    if not isinstance(calendar,dict) or calendar.get('schema')!='tradevice.calendar.utc.v1':
        return result('UNKNOWN','CALENDAR_UNAVAILABLE')
    if calendar.get('time_basis')!='UTC' or calendar.get('complete') is not True:
        return result('UNKNOWN','CALENDAR_TIME_OR_COVERAGE_UNVERIFIED')
    stamp=calendar.get('observed_utc_ms');start=calendar.get('coverage_start_utc_ms');end=calendar.get('coverage_end_utc_ms')
    if any(type(v) is not int or v<0 for v in (stamp,start,end)):
        return result('UNKNOWN','CALENDAR_TIMESTAMP_INVALID')
    if not -1000<=now_ms-stamp<=MAX_CALENDAR_AGE_MS:
        return result('UNKNOWN','CALENDAR_STALE_OR_FUTURE')
    if start>now_ms-HOUR_MS or end<now_ms+HOUR_MS:
        return result('UNKNOWN','CALENDAR_COVERAGE_INCOMPLETE')
    events=calendar.get('events')
    if not isinstance(events,list) or len(events)>10000:return result('UNKNOWN','CALENDAR_EVENTS_INVALID')
    windows=[];seen=set()
    for event in events:
        if not isinstance(event,dict):return result('UNKNOWN','CALENDAR_EVENT_INVALID')
        eid=event.get('id');impact=event.get('impact')
        if not isinstance(eid,str) or not eid or eid in seen or impact not in ('HIGH','MODERATE','LOW','NONE'):
            return result('UNKNOWN','CALENDAR_EVENT_INVALID')
        seen.add(eid)
        if impact!='HIGH':continue
        when=event.get('scheduled_utc_ms')
        if type(when) is not int or when<0 or event.get('time_confirmed') is not True:
            return result('UNKNOWN','HIGH_IMPACT_TIME_UNCONFIRMED')
        if not start<=when<=end:return result('UNKNOWN','EVENT_OUTSIDE_DECLARED_COVERAGE')
        windows.append((when-HOUR_MS,when+HOUR_MS,eid))
    merged=[]
    for left,right,eid in sorted(windows):
        if merged and left<=merged[-1][1]:
            merged[-1][1]=max(merged[-1][1],right);merged[-1][2].append(eid)
        else:merged.append([left,right,[eid]])
    for left,right,ids in merged:
        if left<=now_ms<=right:return result('BLACKOUT','HIGH_IMPACT_NEWS_WINDOW',right,ids)
    return result('CLEAR','NO_HIGH_IMPACT_WINDOW')

