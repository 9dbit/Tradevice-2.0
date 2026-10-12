"""Member security: verify owner scope survives an upstream RLS or proxy mistake."""
import httpx
import pytest
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app

A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
AC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
AC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
REF = "abcdefghijklmnopqrst"
CONF = Settings("https://" + REF + ".supabase.co", "sb_publishable_test", REF)


def fake_server(foreign=None, confirmed=True, anonymous=False, member_allowed=True, failed_table=None):
    observed=[]
    def respond(req):
        observed.append((req.url.path, req.headers.get("authorization")))
        tok=req.headers.get("authorization")
        user = A if tok == "Bearer user-a" else B if tok == "Bearer user-b" else None
        if req.url.path=="/auth/v1/user":
            if user is None:
                return httpx.Response(401)
            return httpx.Response(200,json={"id":user,"email_confirmed_at":"2026-10-12" if confirmed else None,
                                            "is_anonymous":anonymous})
        if user is None:
            return httpx.Response(401)
        table=req.url.path.removeprefix("/rest/v1/")
        if table==failed_table:
            return httpx.Response(503)
        if table=="copy_profiles":
            return httpx.Response(200,json=[{"user_id":user}] if member_allowed else [])
        owner_account=AC_A if user==A else AC_B
        if table=="copy_accounts":
            if "id" in req.url.params:
                asked=req.url.params["id"].removeprefix("eq.")
                if asked!=owner_account and foreign!="detail":
                    return httpx.Response(200,json=[])
                return httpx.Response(200,json=[{"id":asked,"user_id":B if foreign=="detail" else user,
                                                 "environment":"paper"}])
            return httpx.Response(200,json=[{"id":owner_account,"user_id":B if foreign=="list" else user,
                                             "environment":"paper"}])
        if table=="copy_orders":
            return httpx.Response(200,json=[{"id":AC_A,"account_id":AC_B if foreign=="orders" else owner_account,
                                             "status":"queued"}])
        if table=="copy_risk_profiles":
            return httpx.Response(200,json=[{"account_id":AC_B if foreign=="risk" else owner_account,
                                             "risk_per_trade_pct":0.25,"is_enabled":False}])
        if table=="copy_referrals":
            return httpx.Response(200,json=[{"id":AC_A,"referrer_user_id":B if foreign=="referrals" else user}])
        if table=="copy_strategies":
            return httpx.Response(200,json=[])
        return httpx.Response(404)
    return TestClient(create_app(CONF,httpx.MockTransport(respond))),observed


@pytest.mark.parametrize("headers", [{}, {"Authorization":"Bearer invalid"},
                                      {"Authorization":"Basic aGVsbG8="}])
def test_invalid_token_denied(headers):
    client,_=fake_server()
    with client:
        r=client.get("/api/v1/accounts",headers=headers)
        assert r.status_code==401


@pytest.mark.parametrize("flags,code", [
    ({"confirmed":False},"EMAIL_CONFIRMATION_REQUIRED"),
    ({"anonymous":True},"VERIFIED_MEMBER_REQUIRED"),
    ({"member_allowed":False},"PILOT_ACCESS_REQUIRED"),
])
def test_member_gate_fail_closed(flags,code):
    client,_=fake_server(**flags)
    with client:
        r=client.get("/api/v1/me",headers={"Authorization":"Bearer user-a"})
        assert r.status_code==403
        assert r.json()["detail"]["code"]==code


def test_two_distinct_members_and_scope():
    client,seen=fake_server()
    with client:
        for token,uid,account in [("user-a",A,AC_A),("user-b",B,AC_B)]:
            h={"Authorization":"Bearer "+token}
            assert client.get("/api/v1/me",headers=h).json()["id"]==uid
            response=client.get("/api/v1/accounts",headers=h)
            assert response.status_code==200
            assert response.json()["items"]==[{"id":account,"environment":"paper"}]
            assert client.get("/api/v1/accounts/"+account,headers=h).status_code==200
            assert client.get("/api/v1/accounts/"+account+"/orders",headers=h).status_code==200
            assert client.get("/api/v1/accounts/"+account+"/risk",headers=h).status_code==200
            assert client.get("/api/v1/referrals",headers=h).status_code==200
        for p in ["/api/v1/accounts/"+AC_B, "/api/v1/accounts/"+AC_B+"/orders",
                  "/api/v1/accounts/"+AC_B+"/risk"]:
            assert client.get(p,headers={"Authorization":"Bearer user-a"}).status_code==404
        assert not any(x[0]=="/rest/v1/copy_orders" and x[1]=="Bearer invalid" for x in seen)


@pytest.mark.parametrize("foreign,endpoint,expected", [
    ("list","/api/v1/accounts",503),
    ("detail","/api/v1/accounts/"+AC_B,404),
    ("orders","/api/v1/accounts/"+AC_A+"/orders",503),
    ("risk","/api/v1/accounts/"+AC_A+"/risk",503),
    ("referrals","/api/v1/referrals",503),
])
def test_mismatched_upstream_rows_never_return(foreign,endpoint,expected):
    client,_=fake_server(foreign=foreign)
    with client:
        response=client.get(endpoint,headers={"Authorization":"Bearer user-a"})
        assert response.status_code==expected
        assert AC_B not in response.text
        assert response.json()["detail"]["code"] in ("ACCOUNT_NOT_FOUND","OWNER_SCOPE_VIOLATION")


@pytest.mark.parametrize("path", ["/api/v1/paper/orders",
    "/api/v1/funding/deposit-intents","/api/v1/funding/withdrawal-intents"])
def test_authenticated_member_cannot_execute_or_fund(path):
    client,_=fake_server()
    with client:
        response=client.post(path,headers={"Authorization":"Bearer user-a"})
        assert response.status_code==409


def test_backend_outage_cannot_fall_back_to_unscoped_data():
    client,_=fake_server(failed_table="copy_accounts")
    with client:
        response=client.get("/api/v1/accounts",headers={"Authorization":"Bearer user-a"})
        assert response.status_code==503
        assert response.json()["detail"]["code"]=="DATA_UNAVAILABLE"
