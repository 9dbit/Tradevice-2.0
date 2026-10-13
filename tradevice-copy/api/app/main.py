"""Read-only member API. No live broker SDK or money movement."""
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID
import hmac
import logging
import psycopg
import os
import re
import time
from .observer_telemetry import ObserverBuffer, ObserverRejected, ObserverRateLimited, BODY_MAX_BYTES, verify_hmac
from fastapi.concurrency import run_in_threadpool
from .master_telemetry import read_database, allowed_reader_dsn
from .master_control import allowed_operator_dsn,submit_command,validate_command

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from typing import Literal
from .config import Settings

master_logger = logging.getLogger('tradevice.master.telemetry')
bearer = HTTPBearer(auto_error=False)

class OperatorCommand(BaseModel):
    model_config=ConfigDict(extra="forbid")
    actor_id: UUID
    request_id: UUID
    action: Literal["START","STOP","CONFIGURE","RESET_SESSION"]
    cycle_mode: Literal["CONTINUOUS","CUSTOM"] | None = None
    target_cycles: int | None = None
    news_policy: Literal["AVOID","ALLOW","ONLY"] | None = None


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
    # Ephemeral, single-instance staging market DISPLAY cache. No database writes.
    application.state.observer_market = ObserverBuffer()
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

    @application.post("/internal/master/observer", status_code=202)
    async def internal_master_readonly_observer(request: Request):
        # Distinct HMAC key from the master command/telemetry secret. Staging only.
        if settings.environment != "staging" or settings.project_ref != "scqzlcivherovlwqypeu":
            raise problem(503, "MASTER_STAGING_ONLY")
        secret = os.getenv("MASTER_OBSERVER_SHARED_SECRET", "")
        if not re.fullmatch(r"[0-9a-f]{64}", secret):
            raise problem(503, "MASTER_OBSERVER_NOT_CONFIGURED")
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > BODY_MAX_BYTES:
                raise problem(413, "MASTER_OBSERVER_BODY_TOO_LARGE")
        body = bytes(chunks)
        now_ms = int(time.time() * 1000)
        try:
            verify_hmac(
                secret,
                request.headers.get("x-tradevice-observer-time", ""),
                request.headers.get("x-tradevice-observer-signature", ""),
                body,
                now_ms,
            )
        except ObserverRejected:
            raise problem(401, "MASTER_OBSERVER_AUTH_DENIED") from None
        try:
            application.state.observer_market.receive(body, now_ms)
        except ObserverRateLimited:
            raise problem(429, "MASTER_OBSERVER_RATE_LIMITED") from None
        except ObserverRejected:
            raise problem(422, "MASTER_OBSERVER_INVALID_OR_STALE") from None
        # Never confer quote readiness, broker execution, news readiness, or START permissions.
        return {"status": "ACCEPTED_READ_ONLY", "tradingReady": False, "executionEnabled": False}

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
            payload = await run_in_threadpool(read_database, dsn)
            payload["market"] = application.state.observer_market.market(int(time.time()*1000))
            payload["control"]["operatorConfigured"] = allowed_operator_dsn(
                os.getenv("MASTER_OPERATOR_DATABASE_URL",""))
            return payload
        except psycopg.Error as exc:
            # Never log DSNs, usernames/passwords, SQL or payloads. SQLSTATE is safe diagnostics.
            master_logger.warning("master_telemetry_db_failed type=%s sqlstate=%s",
                                  type(exc).__name__, exc.sqlstate or "NONE")
            raise problem(503, "MASTER_READ_DB_ACCESS_FAILED") from None
        except RuntimeError as exc:
            master_logger.warning("master_telemetry_runtime_failed type=%s", type(exc).__name__)
            raise problem(503, "MASTER_READ_DB_IDENTITY_FAILED") from None
        except Exception as exc:
            master_logger.warning("master_telemetry_processing_failed type=%s", type(exc).__name__)
            raise problem(503, "MASTER_TELEMETRY_PROCESSING_FAILED") from None

    @application.post("/internal/master/command", status_code=202)
    async def internal_master_command(request: Request, command: OperatorCommand):
        # Server-to-server only. No member browser access or live broker SDK.
        if settings.environment != "staging" or settings.project_ref != "scqzlcivherovlwqypeu":
            raise problem(503, "MASTER_STAGING_ONLY")
        expected = os.getenv("MASTER_TELEMETRY_SHARED_SECRET", "")
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise problem(503, "MASTER_COMMAND_SECRET_NOT_CONFIGURED")
        if not hmac.compare_digest(request.headers.get("x-tradevice-master-secret", ""), expected):
            raise problem(401, "MASTER_INTERNAL_AUTH_REQUIRED")
        payload = command.model_dump()
        try:
            validate_command(payload)
        except ValueError:
            raise problem(422, "MASTER_COMMAND_INVALID") from None
        dsn = os.getenv("MASTER_OPERATOR_DATABASE_URL", "")
        if not allowed_operator_dsn(dsn):
            raise problem(503, "MASTER_OPERATOR_NOT_CONFIGURED")
        try:
            return await run_in_threadpool(submit_command, dsn, payload)
        except (psycopg.Error, RuntimeError):
            raise problem(503, "MASTER_COMMAND_UNAVAILABLE") from None

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
