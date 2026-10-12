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
