"""Read-only member API. No live broker SDK or money movement."""
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID
import hmac
import os
import re
from fastapi.concurrency import run_in_threadpool
from .master_telemetry import read_database, allowed_reader_dsn

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from .config import Settings

bearer = HTTPBearer(auto_error=False)

def problem(status: int, code: str) -> HTTPException:
    return HTTPException(status, detail={"code": code})

@dataclass(frozen=True)
class Member:
    id: UUID
    token: str

async def member(request: Request, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> Member:
    if credentials is None or not credentials.credentials or len(credentials.credentials) > 16384:
        raise problem(401, "AUTH_REQUIRED")
    settings: Settings = request.app.state.settings
    if not settings.auth_configured:
        raise problem(503, "AUTH_NOT_CONFIGURED")
    try:
        response = await request.app.state.http.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"apikey": settings.publishable_key, "Authorization": f"Bearer {credentials.credentials}"},
        )
    except httpx.RequestError:
        raise problem(503, "AUTH_UNAVAILABLE") from None
    if response.status_code in (401, 403):
        raise problem(401, "INVALID_TOKEN")
    if response.status_code != 200:
        raise problem(503, "AUTH_UNAVAILABLE")
    try:
        data = response.json()
        uid = UUID(data["id"])
        if data.get("is_anonymous") or data.get("deleted_at"):
            raise problem(403, "VERIFIED_MEMBER_REQUIRED")
        if not data.get("email_confirmed_at"):
            raise problem(403, "EMAIL_CONFIRMATION_REQUIRED")
    except (ValueError, TypeError, KeyError, AttributeError):
        raise problem(503, "AUTH_INVALID_RESPONSE") from None
    identity = Member(uid, credentials.credentials)
    profiles = await rows(request, identity, "copy_profiles", {
        "select": "user_id", "user_id": f"eq.{uid}", "limit": "1",
    })
    if len(profiles) != 1 or profiles[0].get("user_id") != str(uid):
        raise problem(403, "PILOT_ACCESS_REQUIRED")
    return identity

async def rows(request: Request, identity: Member, table: str, params: dict) -> list[dict]:
    """Forward the member JWT, not a service-role key: RLS remains in force."""
    settings: Settings = request.app.state.settings
    try:
        response = await request.app.state.http.get(
            f"{settings.supabase_url}/rest/v1/{table}", params=params,
            headers={"apikey": settings.publishable_key, "Authorization": f"Bearer {identity.token}"},
        )
    except httpx.RequestError:
        raise problem(503, "DATA_UNAVAILABLE") from None
    if response.status_code in (401, 403):
        raise problem(403, "DATA_ACCESS_DENIED")
    if response.status_code != 200:
        raise problem(503, "DATA_UNAVAILABLE")
    try:
        data = response.json()
        if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
            raise ValueError("Invalid rowset")
        return data
    except ValueError:
        raise problem(503, "DATA_INVALID_RESPONSE") from None

async def owned_account(request: Request, identity: Member, account_id: UUID) -> dict:
    data = await rows(request, identity, "copy_accounts", {
        "select": "id,user_id,broker_id,external_account_id,environment,created_at",
        "id": f"eq.{account_id}", "user_id": f"eq.{identity.id}", "limit": "1",
    })
    if not data or len(data) != 1 or data[0].get("id") != str(account_id) or data[0].get("user_id") != str(identity.id):
        raise problem(404, "ACCOUNT_NOT_FOUND")
    return {k: v for k, v in data[0].items() if k != "user_id"}

def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, transport=transport) as client:
            application.state.http = client
            yield
    application = FastAPI(title="Tradevice Copy Foundation", version="0.2.0", lifespan=lifespan)
    application.state.settings = settings
    if settings.cors_origins:
        application.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                                   allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])
    @application.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response
    @application.get("/health")
    async def health():
        return {"status": "ok", "version": "0.2.0", "execution_mode": "paper",
                "live_execution": False, "copy_execution": False, "environment": settings.environment,
                "auth_configured": settings.auth_configured}
    @application.get("/readyz")
    async def readiness():
        if not settings.auth_configured:
            raise problem(503, "SUPABASE_NOT_CONFIGURED")
        try:
            response = await application.state.http.get(f"{settings.supabase_url}/auth/v1/settings",
                                                       headers={"apikey": settings.publishable_key})
        except httpx.RequestError:
            raise problem(503, "AUTH_UNAVAILABLE") from None
        if response.status_code != 200:
            raise problem(503, "AUTH_UNAVAILABLE")
        return {"status": "auth_reachable", "database_verified": False, "live_execution": False}
    @application.get("/internal/master/telemetry")
    async def internal_master_telemetry(request: Request):
        # Authenticated server-to-server access ONLY, never forwarded to browser or member routes.
        if settings.environment != "staging" or settings.project_ref != "scqzlcivherovlwqypeu":
            raise problem(503, "MASTER_STAGING_ONLY")
        expected = os.getenv("MASTER_TELEMETRY_SHARED_SECRET", "")
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise problem(503, "MASTER_TELEMETRY_NOT_CONFIGURED")
        provided = request.headers.get("x-tradevice-master-secret", "")
        if not hmac.compare_digest(expected, provided):
            raise problem(401, "MASTER_INTERNAL_AUTH_REQUIRED")
        dsn = os.getenv("MASTER_READ_DATABASE_URL", "")
        if not allowed_reader_dsn(dsn):
            raise problem(503, "MASTER_READ_DB_NOT_CONFIGURED")
        try:
            return await run_in_threadpool(read_database, dsn)
        except Exception:
            raise problem(503, "MASTER_TELEMETRY_UNAVAILABLE") from None
    @application.get("/api/v1/me")
    async def me(identity: Member = Depends(member)):
        return {"id": str(identity.id), "execution_mode": "paper"}
    @application.get("/api/v1/accounts")
    async def accounts(request: Request, identity: Member = Depends(member), offset: int = Query(default=0, ge=0, le=10000)):
        data = await rows(request, identity, "copy_accounts", {
            "select": "id,user_id,broker_id,external_account_id,environment,created_at", "user_id": f"eq.{identity.id}",
            "order": "id.asc", "limit": "51", "offset": str(offset),
        })
        if any(row.get("user_id") != str(identity.id) for row in data):
            raise problem(503, "OWNER_SCOPE_VIOLATION")
        visible = [{k: v for k, v in row.items() if k != "user_id"} for row in data[:50]]
        return {"items": visible, "next_offset": offset + 50 if len(data) > 50 else None, "source": "supabase_rls"}
    @application.get("/api/v1/accounts/{account_id}")
    async def account(account_id: UUID, request: Request, identity: Member = Depends(member)):
        return await owned_account(request, identity, account_id)
    @application.get("/api/v1/accounts/{account_id}/orders")
    async def orders(account_id: UUID, request: Request, identity: Member = Depends(member), offset: int = Query(default=0, ge=0, le=10000)):
        await owned_account(request, identity, account_id)
        data = await rows(request, identity, "copy_orders", {
            "select": "id,account_id,signal_id,status,paper_order_id", "account_id": f"eq.{account_id}",
            "order": "id.asc", "limit": "51", "offset": str(offset),
        })
        if any(row.get("account_id") != str(account_id) for row in data):
            raise problem(503, "OWNER_SCOPE_VIOLATION")
        visible = [{k: v for k, v in row.items() if k != "account_id"} for row in data[:50]]
        return {"items": visible, "next_offset": offset + 50 if len(data) > 50 else None}
    @application.get("/api/v1/accounts/{account_id}/risk")
    async def risk(account_id: UUID, request: Request, identity: Member = Depends(member)):
        await owned_account(request, identity, account_id)
        data = await rows(request, identity, "copy_risk_profiles", {
            "select": "account_id,risk_per_trade_pct,daily_loss_limit_pct,is_enabled", "account_id": f"eq.{account_id}", "limit": "1",
        })
        if len(data) > 1 or any(row.get("account_id") != str(account_id) for row in data):
            raise problem(503, "OWNER_SCOPE_VIOLATION")
        return {"profile": data[0] if data else None, "editable": False}
    @application.get("/api/v1/strategies")
    async def strategies(request: Request, identity: Member = Depends(member)):
        data = await rows(request, identity, "copy_strategies", {"select": "id,code,symbol,enabled", "order": "id.asc", "limit": "100"})
        return {"items": data, "can_subscribe_live": False}
    @application.get("/api/v1/referrals")
    async def referrals(request: Request, identity: Member = Depends(member), offset: int = Query(default=0, ge=0, le=10000)):
        data = await rows(request, identity, "copy_referrals", {
            "select": "id,referrer_user_id,broker_attribution,created_at", "referrer_user_id": f"eq.{identity.id}",
            "order": "id.asc", "limit": "51", "offset": str(offset),
        })
        if any(row.get("referrer_user_id") != str(identity.id) for row in data):
            raise problem(503, "OWNER_SCOPE_VIOLATION")
        visible = [{k: v for k, v in row.items() if k != "referrer_user_id"} for row in data[:50]]
        return {"items": visible, "next_offset": offset + 50 if len(data) > 50 else None, "commissions_enabled": False}
    @application.post("/api/v1/paper/orders")
    async def paper_order(identity: Member = Depends(member)):
        raise problem(409, "PAPER_EXECUTOR_NOT_CONNECTED")
    @application.post("/api/v1/funding/deposit-intents")
    async def deposit(identity: Member = Depends(member)):
        raise problem(409, "BROKER_FUNDING_NOT_CONFIGURED")
    @application.post("/api/v1/funding/withdrawal-intents")
    async def withdraw(identity: Member = Depends(member)):
        raise problem(409, "BROKER_WITHDRAWAL_NOT_CONFIGURED")
    return application

app = create_app()
