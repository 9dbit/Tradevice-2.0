"""Operator commands are paper-only, fail-closed and never exposed without a shared secret."""
from uuid import uuid4
import pytest

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.master_control import allowed_operator_dsn,validate_command

DSN="postgresql://tradevice_master_operator:secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require"


def sample(action="STOP",**kwargs):
    d={"actor_id":str(uuid4()),"request_id":str(uuid4()),"action":action,
       "cycle_mode":None,"target_cycles":None,"news_policy":None}
    d.update(kwargs)
    return d


def test_operator_url_pinned_to_project_and_writer_identity():
    assert allowed_operator_dsn(DSN)
    assert not allowed_operator_dsn(DSN.replace("tradevice_master_operator","tradevice_master_reader"))
    assert not allowed_operator_dsn(DSN.replace("scqzlcivherovlwqypeu","otherproject"))
    assert not allowed_operator_dsn(DSN.replace("sslmode=require","sslmode=disable"))
    assert not allowed_operator_dsn(" "+DSN)
    assert not allowed_operator_dsn("")


def test_command_action_contract_and_cycle_values():
    validate_command(sample("STOP"))
    validate_command(sample("START"))
    validate_command(sample("RESET_SESSION"))
    validate_command(sample("CONFIGURE",cycle_mode="CONTINUOUS",news_policy="AVOID"))
    validate_command(sample("CONFIGURE",cycle_mode="CUSTOM",target_cycles=100,news_policy="AVOID"))
    # User locked high-impact avoidance; formerly accepted policies now reject.
    for policy in ("ALLOW","ONLY"):
        with pytest.raises(ValueError,match="INVALID_CONFIGURATION"):
            validate_command(sample("CONFIGURE",cycle_mode="CUSTOM",target_cycles=100,news_policy=policy))
    for payload in (
        sample("CONFIGURE",cycle_mode="CUSTOM",target_cycles=0,news_policy="AVOID"),
        sample("CONFIGURE",cycle_mode="CUSTOM",target_cycles=True,news_policy="AVOID"),
        sample("CONFIGURE",cycle_mode="CONTINUOUS",target_cycles=10,news_policy="ALLOW"),
        sample("START",target_cycles=10),
        sample("RESET_SESSION",news_policy="ONLY"),
    ):
        try:
            validate_command(payload)
            raise AssertionError("Invalid command accepted")
        except ValueError:
            pass


def test_internal_master_commands_are_rejected_without_auth(monkeypatch):
    monkeypatch.setenv("MASTER_TELEMETRY_SHARED_SECRET","a"*64)
    monkeypatch.delenv("MASTER_OPERATOR_DATABASE_URL",raising=False)
    app=create_app(settings=Settings(environment="staging",project_ref="scqzlcivherovlwqypeu"))
    with TestClient(app) as client:
        cmd=sample("START")
        assert client.post("/internal/master/command",json=cmd).status_code==401
        assert client.post("/internal/master/command",json=cmd,
            headers={"x-tradevice-master-secret":"b"*64}).status_code==401
        r=client.post("/internal/master/command",json=cmd,
            headers={"x-tradevice-master-secret":"a"*64})
        assert r.status_code==503
        assert r.json()["detail"]["code"]=="MASTER_OPERATOR_NOT_CONFIGURED"


def test_internal_operator_never_available_in_nonstaging(monkeypatch):
    monkeypatch.setenv("MASTER_TELEMETRY_SHARED_SECRET","a"*64)
    app=create_app(settings=Settings(environment="local",project_ref="scqzlcivherovlwqypeu"))
    with TestClient(app) as client:
        r=client.post("/internal/master/command",json=sample(),
            headers={"x-tradevice-master-secret":"a"*64})
        assert r.status_code==503
        assert r.json()["detail"]["code"]=="MASTER_STAGING_ONLY"
