from importlib import import_module
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app
from app.news_calendar import NewsCalendar


def test_calendar_poller_requires_explicit_staging_opt_in(monkeypatch):
    calls=[]
    monkeypatch.setattr(NewsCalendar,'start',lambda self:calls.append('start'))
    for enabled,environment,project,expected in [
        ('false','staging','scqzlcivherovlwqypeu',0),
        ('true','local','scqzlcivherovlwqypeu',0),
        ('true','staging','different',0),
        ('true','staging','scqzlcivherovlwqypeu',1)]:
        calls.clear();monkeypatch.setenv('MASTER_NEWS_CALENDAR_ENABLED',enabled)
        with TestClient(create_app(Settings(environment=environment,project_ref=project))):
            assert len(calls)==expected


def test_authenticated_telemetry_projects_news_without_execution_permissions(monkeypatch):
    main=import_module('app.main')
    monkeypatch.setenv('MASTER_TELEMETRY_SHARED_SECRET','a'*64)
    monkeypatch.setenv('MASTER_READ_DATABASE_URL',
        'postgresql://tradevice_master_reader:TEST_ONLY@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require')
    monkeypatch.setattr(main,'read_database',lambda _:dict(control=dict(newsCalendarReady=False)))
    app=create_app(Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))
    with TestClient(app) as c:
        assert c.get('/internal/master/telemetry').status_code==401
        r=c.get('/internal/master/telemetry',headers={'x-tradevice-master-secret':'a'*64})
        assert r.status_code==200
        d=r.json()
        assert d['news']['provider']=='Forex Factory'
        assert d['news']['status']=='UNKNOWN'
        assert d['news']['orderDispatchAuthorized'] is False
        assert d['control']['newsCalendarReady'] is False
        health=c.get('/health').json()
        assert health['live_execution'] is False
        assert 'highImpactEvents' not in health['news_calendar']
