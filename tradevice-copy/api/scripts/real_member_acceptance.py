"""Opt-in real Supabase staging pilot security acceptance.

Requires two previously invited, confirmed staging-only users with separate paper
accounts. Secrets arrive only through environment variables. Never commits or logs
passwords, JWTs or refresh tokens. No broker or funding action is permitted.
"""
import os
import sys
from uuid import UUID
import httpx

SUPABASE = "https://scqzlcivherovlwqypeu.supabase.co"
API = "https://copy-api-staging-4c33.up.railway.app"


def need(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError("Missing required secure environment input: " + name)
    return value


def check(ok, stage):
    if not ok:
        raise ValueError("Phase 2 acceptance gate failed: " + stage)


def bearer(token):
    return {"Authorization": "Bearer " + token}


def login(http, key, email, password):
    response = http.post(SUPABASE + "/auth/v1/token?grant_type=password",
                         json={"email": email, "password": password}, headers={"apikey": key})
    check(response.status_code == 200, "pilot authentication")
    tokens = response.json()
    access = tokens.get("access_token", "")
    refresh = tokens.get("refresh_token", "")
    check(bool(access and refresh), "access and refresh tokens issued")
    user = http.get(SUPABASE + "/auth/v1/user", headers={"apikey": key, **bearer(access)})
    check(user.status_code == 200, "token resolves to user")
    identity = user.json()
    check(bool(identity.get("email_confirmed_at")) and not identity.get("is_anonymous"),
          "verified permanent user")
    return UUID(identity["id"]), access, refresh


def db_read(http, key, token, table, params):
    response = http.get(SUPABASE + "/rest/v1/" + table,
                        headers={"apikey": key, **bearer(token)}, params=params)
    check(response.status_code == 200, "RLS select " + table)
    rows = response.json()
    check(isinstance(rows, list), "valid RLS response")
    return rows


def main():
    key = need("COPY_STAGING_PUBLISHABLE_KEY")
    check(key.startswith("sb_publishable_"), "never use server secret")
    credentials = [(need("COPY_PILOT_A_EMAIL"), need("COPY_PILOT_A_PASSWORD")),
                   (need("COPY_PILOT_B_EMAIL"), need("COPY_PILOT_B_PASSWORD"))]
    check(credentials[0][0].lower() != credentials[1][0].lower(), "two distinct pilots")
    with httpx.Client(timeout=12, follow_redirects=False) as http:
        pairs = [login(http, key, *person) for person in credentials]
        check(pairs[0][0] != pairs[1][0], "two unique JWT subjects")
        paper_ids = {}
        for uid, token, _ in pairs:
            me = http.get(API + "/api/v1/me", headers=bearer(token))
            check(me.status_code == 200 and me.json().get("id") == str(uid),
                  "API verified pilot identity")
            response = http.get(API + "/api/v1/accounts", headers=bearer(token))
            check(response.status_code == 200, "member API account list")
            accounts = response.json().get("items", [])
            check(bool(accounts), "real pilot account exists")
            owned = db_read(http, key, token, "copy_accounts",
                            {"select": "id,user_id,environment"})
            check(bool(owned) and all(row.get("user_id") == str(uid) and
                                      row.get("environment") == "paper" for row in owned),
                  "JWT PostgREST ownership and paper-only")
            selected = accounts[0]["id"]
            check(any(row["id"] == selected for row in owned), "API and RLS agree")
            paper_ids[str(uid)] = selected
        for me, other in ((pairs[0], pairs[1]), (pairs[1], pairs[0])):
            uid, access, _ = me
            foreign = paper_ids[str(other[0])]
            for route in ("/api/v1/accounts/" + foreign,
                          "/api/v1/accounts/" + foreign + "/orders",
                          "/api/v1/accounts/" + foreign + "/risk"):
                check(http.get(API + route, headers=bearer(access)).status_code == 404,
                      "foreign member API denial")
            for table, column in (("copy_accounts", "id"),
                                  ("copy_orders", "account_id"),
                                  ("copy_risk_profiles", "account_id"),
                                  ("copy_subscriptions", "account_id")):
                rows = db_read(http, key, access, table,
                               {"select": "*", column: "eq." + foreign, "limit": "5"})
                check(not rows, "direct PostgREST foreign row denial " + table)
            for route in ("/api/v1/paper/orders",
                          "/api/v1/funding/deposit-intents",
                          "/api/v1/funding/withdrawal-intents"):
                check(http.post(API + route, headers=bearer(access)).status_code == 409,
                      "paper-only execution gate")
        for headers in ({}, bearer("invalid-token")):
            check(http.get(API + "/api/v1/accounts", headers=headers).status_code == 401,
                  "missing or invalid JWT")
        for uid, _, refresh in pairs:
            rotated = http.post(SUPABASE + "/auth/v1/token?grant_type=refresh_token",
                                headers={"apikey": key}, json={"refresh_token": refresh})
            check(rotated.status_code == 200, "refresh succeeds")
            rotated_data = rotated.json()
            new_access = rotated_data.get("access_token", "")
            new_refresh = rotated_data.get("refresh_token", "")
            check(bool(new_access and new_refresh), "refresh rotates token")
            verified = http.get(API + "/api/v1/me", headers=bearer(new_access))
            check(verified.status_code == 200 and verified.json().get("id") == str(uid),
                  "refreshed session still owner scoped")
            logout = http.post(SUPABASE + "/auth/v1/logout",
                               headers={"apikey": key, **bearer(new_access)})
            check(logout.status_code in (200, 204), "logout")
            reuse = http.post(SUPABASE + "/auth/v1/token?grant_type=refresh_token",
                              headers={"apikey": key},
                              json={"refresh_token": new_refresh})
            check(reuse.status_code in (400, 401, 403), "refresh revoked after logout")
    print("REAL_PILOT_PHASE_2_PASS: two users, JWT/RLS, BOLA denial, session refresh/logout, paper-only")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, httpx.HTTPError) as exc:
        # Do not print upstream responses or exception details with auth tokens.
        print("REAL_PILOT_PHASE_2_FAILED: " + type(exc).__name__)
        sys.exit(1)
