# Tradevice 2.0 Architecture

## Goal

Build an AI-assisted XAUUSD scalping research system where the model proposes structured trade ideas, deterministic code validates risk, and MT5 remains the execution boundary.

## Safety boundary

Current production mode is **SHADOW ONLY**.

The MCP server can:
- read the latest market snapshot;
- read recent decisions;
- read performance summaries;
- journal a shadow decision;
- record a shadow outcome.

The MCP server cannot:
- place, modify, or close MT5 orders;
- set lot size;
- disable stop loss;
- change risk limits.

## Data flow

1. `mt5/TradeviceObserver.mq5` watches XAUUSD continuously.
2. On each new M1 candle it sends the last 60 completed M1 candles plus M5/M15 context, bid, ask, spread and account telemetry.
3. Tradevice API stores the snapshot.
4. An AI agent reads the snapshot through MCP.
5. The agent returns one of: `WAIT`, `PLACE_PENDING`, `CANCEL`.
6. A deterministic Risk Governor validates the idea.
7. The decision is journaled in shadow mode.
8. A later evaluator records `TP`, `SL`, `EXPIRED`, `CANCELLED`, or `CLOSED` plus PnL, MFE and MAE.
9. Rolling 20/50/100/250-trade analysis is used to compare strategy versions before any promotion toward demo execution.

## V1 setup families

- `TREND_PULLBACK`
- `BREAKOUT_RETEST`
- `LIQUIDITY_SWEEP`

## V1 regimes

- `TREND_UP`
- `TREND_DOWN`
- `RANGE`
- `BREAKOUT`
- `HIGH_VOLATILITY`
- `CHAOTIC`
- `NO_TRADE`

## Risk Governor

Current checks include:
- required pending-order fields;
- valid SL/entry/TP price structure;
- minimum reward/risk;
- maximum spread;
- pending-order placement relative to current bid/ask.

Future checks before demo execution:
- account equity and daily loss ceiling;
- risk per trade and lot sizing;
- maximum simultaneous exposure;
- cooldown after loss streaks;
- stale-decision expiration;
- slippage guard;
- heartbeat/fail-closed MT5 bridge;
- hard kill switch.

## Deployment

- GitHub: `9dbit/Tradevice-2.0`
- Railway service: `tradevice-api`
- Public API/MCP host: `https://tradevice-api-production.up.railway.app`
- MCP endpoint: `/mcp`
- Health endpoint: `/health`

## Persistence

`src/store.js` automatically uses PostgreSQL when `DATABASE_URL` is present. Without it, the service deliberately falls back to bounded in-memory storage for bootstrap/testing only.
