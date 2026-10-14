"""Schedule cache regressions; synthetic data is not performance evidence."""
import copy,json,time
import pytest
from app.bridge_calendar import BridgeCalendar,validate_evidence
from app.news_calendar import normalize
from app.news_policy import MAX_CALENDAR_AGE_MS
from test_news_calendar import response,NOW

def evidence(now=NOW):
    c,p=normalize(*response(now),now)
    c['events']=[e for e in c['events'] if e['impact']=='HIGH']
    return dict(calendar=c,provenance=p,error=None,nextFetchAt=now+21600000,policyVersion='SCHEDULE_6H_V1')

def test_one_snapshot_drives_blackout_transitions_without_provider_fetch():
    clock=[NOW];cache=BridgeCalendar(clock=lambda:clock[0],transport=lambda:pytest.fail('no provider fetch'))
    data=evidence();data['calendar']['events'][0]['scheduled_utc_ms']=NOW+7200000
    cache.accept(data,NOW)
    assert cache.projection()['status']=='CLEAR'
    clock[0]=NOW+3600000;cache.accept(data,clock[0])
    assert cache.projection()['status']=='BLACKOUT'
    clock[0]=NOW+10800001;cache.accept(data,clock[0])
    assert cache.projection()['status']=='CLEAR'
    assert cache.projection()['observedAt']==NOW
    assert cache.projection()['validUntil']==NOW+MAX_CALENDAR_AGE_MS
    clock[0]=NOW+MAX_CALENDAR_AGE_MS+1;cache.accept(data,clock[0])
    assert cache.projection()['status']=='UNKNOWN'

def test_no_freshness_laundering_bridge_loss_and_replay():
    cache=BridgeCalendar(clock=lambda:NOW);data=evidence();cache.accept(data,NOW)
    assert cache.projection(NOW+15001)['reason']=='CALENDAR_BRIDGE_STALE'
    cache.accept(None,NOW-1)
    assert cache.projection()['observedAt']==NOW
    cache.accept({**data,'calendar':None,'provenance':None,'error':'HTTP_429'},NOW+1)
    assert cache.projection()['status']=='UNKNOWN'
    assert cache.projection()['reason']=='CALENDAR_HTTP_429'

@pytest.mark.parametrize('mutation',[
 lambda v:v['provenance'].update(url='https://untrusted.example'),
 lambda v:v['provenance'].update(sha256='x'),
 lambda v:v['calendar'].update(observed_utc_ms=NOW+1),
 lambda v:v['calendar']['events'].append(v['calendar']['events'][0]),
 lambda v:v.update(error='HTTP_429'),
 lambda v:v['calendar']['events'][0].update(time_confirmed=False),
 lambda v:v['calendar']['events'][0].update(currency=42),
])
def test_malformed_evidence_rejected(mutation):
    v=evidence();mutation(v)
    with pytest.raises(ValueError):validate_evidence(v,NOW)

def test_api_and_clone_policy_are_identical():
    from pathlib import Path
    root=Path(__file__).resolve().parents[2]
    api=(root/'api/app/news_policy.py').read_text().strip()
    engine=(root/'engine-bridge/calendar/v51_news_guard.py').read_text().split('\n\ndef supervised_step')[0].strip()
    assert api==engine

def test_authenticated_exchange_updates_health_and_unauthorized_cannot(monkeypatch):
    import importlib
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.config import Settings
    from app.demo_control import signature,validate_snapshot
    from test_demo_control import snapshot
    main=importlib.import_module('app.main');secret='b'*64
    monkeypatch.setenv('MASTER_DEMO_BRIDGE_SECRET',secret)
    p=snapshot();p['news']=evidence(p['observedMs'])
    def exchange(dsn,payload):
        validate_snapshot(payload,int(time.time()*1000))
        return dict(serverMs=payload['observedMs'],calendarEvidencePolicy='SCHEDULE_6H_V1',selection={},commands=[],confirmed=[])
    monkeypatch.setattr(main.demo_control,'exchange',exchange)
    with TestClient(create_app(Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))) as client:
        body=json.dumps(p).encode();stamp=str(p['observedMs'])
        assert client.post('/internal/master/demo/exchange',content=body).status_code==401
        assert client.get('/health').json()['news_calendar']['status']=='UNKNOWN'
        result=client.post('/internal/master/demo/exchange',content=body,headers={'x-tradevice-demo-time':stamp,'x-tradevice-demo-signature':signature(secret,stamp,body)})
        assert result.status_code==200
        view=client.get('/health').json()
        assert view['news_calendar']['observedAt']==p['news']['calendar']['observed_utc_ms']
        assert view['news_calendar']['status'] in ('CLEAR','BLACKOUT')
        assert view['live_execution'] is False
