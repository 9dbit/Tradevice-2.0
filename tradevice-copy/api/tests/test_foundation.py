from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_paper_only():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["live_execution"] is False

def test_protected_routes():
    for path in ("/api/v1/me", "/api/v1/accounts", "/api/v1/strategies"):
        assert client.get(path).status_code == 401

def test_funding_denied_without_auth():
    assert client.post("/api/v1/funding/withdrawal-intents").status_code == 401
    assert client.post("/api/v1/funding/deposit-intents").status_code == 401
