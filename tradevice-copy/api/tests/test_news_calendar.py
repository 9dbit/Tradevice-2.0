"""Synthetic fixtures test safety contracts, not trading performance."""
import json
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.error import HTTPError
import pytest
from app.news_calendar import NewsCalendar, normalize, utc_ms, NoRedirect, URL

NOW=utc_ms('2026-10-14T12:00:00Z')
def rows():
    return [dict(title='Fixture boundary',country='JPY',impact='Low',date='2026-10-12T08:00:00-04:00'),
            dict(title='Fixture high',country='USD',impact='High',date='2026-10-14T08:30:00-04:00'),
            dict(title='Fixture boundary end',country='CAD',impact='Medium',date='2026-10-16T08:30:00-04:00')]
def response(now=NOW,data=None,age=0):
    stamp=format_datetime(datetime.fromtimestamp(now/1000,timezone.utc),usegmt=True)
    return json.dumps(rows() if data is None else data).encode(),{
        'Content-Type':'application/json','Date':stamp,'Last-Modified':stamp,'Age':str(age)}
def cache(data=None,now=NOW):
    clock=[now]
    c=NewsCalendar(transport=lambda:response(clock[0],data),clock=lambda:clock[0])
    c.refresh()
    return c,clock

@pytest.mark.parametrize('delta,status',[(-3600001,'CLEAR'),(-3600000,'BLACKOUT'),(0,'BLACKOUT'),(3600000,'BLACKOUT'),(3600001,'CLEAR')])
def test_inclusive_window(delta,status):
    c,_=cache(now=utc_ms(rows()[1]['date'])+delta)
    p=c.projection()
    assert p['status']==status
    assert p['orderDispatchAuthorized'] is False
    assert p['superviseExistingBasket'] is True

def test_transition_without_network_and_expiry():
    event=utc_ms(rows()[1]['date'])
    c,clock=cache(now=event-3600001)
    assert c.projection()['status']=='CLEAR'
    clock[0]+=1
    assert c.projection()['status']=='BLACKOUT'
    clock[0]+=22_200_001
    assert c.projection()['status']=='UNKNOWN'
    assert not c.projection()['entriesAllowed']

def test_overlapping_windows_extend_end_all_currencies():
    data=rows()+[dict(title='Other high',country='AUD',impact='High',date='2026-10-14T09:30:00-04:00')]
    c,_=cache(data)
    assert c.projection()['blackoutUntil']==utc_ms('2026-10-14T14:30:00Z')

@pytest.mark.parametrize('date',['Tentative','2026-10-14T08:30:00',None])
def test_unconfirmed_time_never_clear(date):
    data=rows();data[1]['date']=date
    c,_=cache(data)
    assert c.projection()['status']=='UNKNOWN'

def test_stale_week_and_incomplete_edges():
    for now in [NOW+7*86400000,utc_ms(rows()[0]['date'])]:
        c,_=cache(now=now)
        assert c.projection()['status']=='UNKNOWN'

def test_failure_invalidates_previous_snapshot_and_respects_retry_after():
    c,clock=cache()
    def limited():raise HTTPError(URL,429,'limited',{'Retry-After':'900'},None)
    c.transport=limited;clock[0]+=300000
    c.refresh()
    assert c.projection()['reason']=='CALENDAR_HTTP_429'
    assert not c.projection()['entriesAllowed']
    assert c.next_fetch==clock[0]+900000
    c.transport=lambda:pytest.fail('must not retry')
    clock[0]+=300000
    assert c.refresh() is False

def test_refresh_cooldown_and_source_cache_age():
    c,clock=cache()
    c.transport=lambda:pytest.fail('must not fetch twice')
    assert c.refresh() is False
    body,h=response(age=240)
    parsed,_=normalize(body,h,NOW)
    assert parsed['observed_utc_ms']==NOW-240000

def test_last_modified_is_revision_not_heartbeat():
    body,h=response();h['Last-Modified']=response(NOW-3600000)[1]['Date']
    parsed,_=normalize(body,h,NOW)
    assert parsed['observed_utc_ms']==NOW

@pytest.mark.parametrize('body',[b'[]',b'{}',b'[',b'x'*2000001])
def test_bad_body_fails_closed(body):
    c=NewsCalendar(transport=lambda:(body,response()[1]),clock=lambda:NOW)
    c.refresh();assert c.projection()['status']=='UNKNOWN'

def test_dst_and_redirect():
    assert utc_ms('2026-11-02T08:30:00-05:00')==utc_ms('2026-11-02T13:30:00Z')
    with pytest.raises(ValueError,match='REDIRECT_REFUSED'):
        NoRedirect().redirect_request(None,None,302,'',{},'https://other.test')

def test_duplicate_and_unknown_impact():
    for data in [rows()+[rows()[1]],[{**r,'impact':'unexpected'} for r in rows()]]:
        c,_=cache(data)
        assert c.projection()['status']=='UNKNOWN'

def test_unconnected_default_has_no_values():
    p=NewsCalendar().projection(NOW)
    assert p['status']=='UNKNOWN' and p['nextEvent'] is None
    assert p['observedAt'] is None and not p['entriesAllowed']
