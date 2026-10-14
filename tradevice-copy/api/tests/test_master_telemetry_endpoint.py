"""Security regression: internal telemetry is unreachable without exact service-to-service identity."""
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings

def test_internal_master_token_is_required(monkeypatch):
    monkeypatch.setenv("MASTER_TELEMETRY_SHARED_SECRET", "a"*64)
    app=create_app(settings=Settings(project_ref="scqzlcivherovlwqypeu",environment="staging"))
    with TestClient(app) as client:
        no_token=client.get("/internal/master/telemetry")
        assert no_token.status_code==401
        assert no_token.json()["detail"]["code"]=="MASTER_INTERNAL_AUTH_REQUIRED"
        invalid=client.get("/internal/master/telemetry",headers={"x-tradevice-master-secret":"b"*64})
        assert invalid.status_code==401
        valid_but_missing_dsn=client.get("/internal/master/telemetry",headers={"x-tradevice-master-secret":"a"*64})
        assert valid_but_missing_dsn.status_code==503
        assert valid_but_missing_dsn.json()["detail"]["code"]=="MASTER_READ_DB_NOT_CONFIGURED"

def test_internal_master_rejects_production(monkeypatch):
    monkeypatch.setenv("MASTER_TELEMETRY_SHARED_SECRET","a"*64)
    app=create_app(settings=Settings(project_ref="scqzlcivherovlwqypeu",environment="local"))
    with TestClient(app) as client:
        res=client.get("/internal/master/telemetry",headers={"x-tradevice-master-secret":"a"*64})
        assert res.status_code==503
        assert res.json()["detail"]["code"]=="MASTER_STAGING_ONLY"

def test_master_read_failure_returns_safe_diagnostic_not_database_credentials(monkeypatch):
    import psycopg
    from importlib import import_module
    api_main=import_module("app.main")
    monkeypatch.setenv("MASTER_TELEMETRY_SHARED_SECRET","a"*64)
    monkeypatch.setenv("MASTER_READ_DATABASE_URL",
        "postgresql://tradevice_master_reader:NOT_A_REAL_PASSWORD@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require")
    def denied(*_args,**_kwargs):
        raise psycopg.OperationalError("SENSITIVE_DB_CONNECTION_DETAILS_MUST_NOT_BE_RETURNED")
    monkeypatch.setattr(api_main,"read_database",denied)
    app=create_app(settings=Settings(project_ref="scqzlcivherovlwqypeu",environment="staging"))
    with TestClient(app) as client:
        res=client.get("/internal/master/telemetry",headers={"x-tradevice-master-secret":"a"*64})
        assert res.status_code==503
        assert res.json()["detail"]["code"]=="MASTER_READ_DB_ACCESS_FAILED"
        assert "SENSITIVE_DB_CONNECTION_DETAILS" not in res.text

def test_reader_role_mismatch_returns_distinct_diagnostic(monkeypatch):
    from importlib import import_module
    api_main=import_module("app.main")
    monkeypatch.setenv("MASTER_TELEMETRY_SHARED_SECRET","a"*64)
    monkeypatch.setenv("MASTER_READ_DATABASE_URL",
        "postgresql://tradevice_master_reader:NOT_A_REAL_PASSWORD@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require")
    def denied(*_args,**_kwargs):
        raise RuntimeError("sensitive info")
    monkeypatch.setattr(api_main,"read_database",denied)
    app=create_app(settings=Settings(project_ref="scqzlcivherovlwqypeu",environment="staging"))
    with TestClient(app) as client:
        res=client.get("/internal/master/telemetry",headers={"x-tradevice-master-secret":"a"*64})
        assert res.status_code==503
        assert res.json()["detail"]["code"]=="MASTER_READ_DB_IDENTITY_FAILED"

def test_authenticated_route_keeps_history_after_market_ttl(monkeypatch):
    from importlib import import_module
    from test_demo_batch import batch,cycle
    from test_observer_telemetry import fixture,NOW
    main=import_module('app.main')
    monkeypatch.setenv('MASTER_TELEMETRY_SHARED_SECRET','a'*64)
    monkeypatch.setenv('MASTER_READ_DATABASE_URL','postgresql://tradevice_master_reader:TEST_ONLY@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require')
    monkeypatch.setattr(main,'read_database',lambda _:dict(control=dict(newsCalendarReady=False)))
    monkeypatch.setattr(main.time,'time',lambda:(NOW+20000)/1000)
    app=create_app(Settings(environment='staging',project_ref='scqzlcivherovlwqypeu'))
    report=batch();report.update(status='STOPPED',cycles=[cycle()])
    app.state.observer_market.receive(fixture(demo_batch=report),NOW)
    with TestClient(app) as client:
        assert client.get('/internal/master/telemetry').status_code==401
        r=client.get('/internal/master/telemetry',headers={'x-tradevice-master-secret':'a'*64})
        assert r.status_code==200
        data=r.json()
        assert data['market']['bid'] is None
        assert data['demoBatch']['completed']==1
        assert data['demoBatch']['net_completed_usd']==3.5
        assert data['demoBatch']['fresh'] is False
