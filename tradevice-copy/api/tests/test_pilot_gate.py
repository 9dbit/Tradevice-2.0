import httpx
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings

UID = "11111111-1111-4111-8111-111111111111"
REF = "abcdefghijklmnopqrst"
CONFIG = Settings(f"https://{REF}.supabase.co", "sb_publishable_test", REF)
TOKEN = {"Authorization": "Bearer example-token"}

def build(allowed):
    def respond(req):
        if req.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id":UID,"email_confirmed_at":"2026-10-11"})
        if req.url.path == "/rest/v1/copy_profiles":
            assert req.url.params["user_id"] == f"eq.{UID}"
            return httpx.Response(200, json=[{"user_id":UID}] if allowed else [])
        if req.url.path == "/rest/v1/copy_accounts":
            return httpx.Response(200,json=[])
        return httpx.Response(200,json=[])
    return TestClient(create_app(CONFIG, httpx.MockTransport(respond)))

def test_unapproved_member_rejected():
    with build(False) as client:
        r=client.get("/api/v1/me",headers=TOKEN)
        assert r.status_code==403
        assert r.json()["detail"]["code"]=="PILOT_ACCESS_REQUIRED"

def test_approved_member_accessible():
    with build(True) as client:
        assert client.get("/api/v1/me",headers=TOKEN).json()["id"]==UID

def test_approved_member_cannot_move_funds():
    with build(True) as client:
        assert client.post("/api/v1/funding/withdrawal-intents",headers=TOKEN).status_code==409
