import os
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
from uuid import UUID
import httpx

app = FastAPI(title="Tradevice Copy Foundation", version="0.1.0")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "").split(",") if x.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

async def user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(503, "Authentication not configured")
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            result = await client.get(
                f"{url.rstrip('/')}/auth/v1/user",
                headers={"apikey": key, "Authorization": authorization},
            )
        except httpx.RequestError:
            raise HTTPException(503, "Auth service unavailable")
    if result.status_code != 200:
        raise HTTPException(401, "Invalid token")
    uid = result.json().get("id")
    if not uid:
        raise HTTPException(401, "Invalid account")
    return uid

@app.get("/health")
def health():
    return {"status": "ok", "execution_mode": "paper", "live_execution": False}

@app.get("/api/v1/me")
async def me(uid: str = Depends(user_id)):
    return {"id": uid, "execution_mode": "paper"}

@app.get("/api/v1/strategies")
async def strategies(uid: str = Depends(user_id)):
    return {"items": [{"code": "TRADEVICE_SHADOW_XAUUSD", "symbol": "XAUUSD", "status": "research_only", "can_subscribe_live": False}]}

@app.get("/api/v1/accounts")
async def accounts(uid: str = Depends(user_id)):
    return {"items": [], "source": "no_broker_connected"}

class PaperOrder(BaseModel):
    symbol: Literal["XAUUSD"]
    side: Literal["BUY", "SELL"]
    volume: float = Field(gt=0, le=1)
    account_id: UUID

@app.post("/api/v1/paper/orders")
async def paper_order(order: PaperOrder, uid: str = Depends(user_id)):
    # Deliberately no placement: no account ownership verification or broker connection yet.
    raise HTTPException(409, "Paper order submission is disabled until account ownership and risk controls are implemented")

@app.post("/api/v1/funding/deposit-intents")
async def deposit(uid: str = Depends(user_id)):
    raise HTTPException(409, "Broker-hosted funding not configured")

@app.post("/api/v1/funding/withdrawal-intents")
async def withdraw(uid: str = Depends(user_id)):
    raise HTTPException(409, "Broker-hosted withdrawal not configured")
