# Tradevice 2.0

AI-assisted XAUUSD scalping research stack with an MCP server, deterministic risk governor, MT5 observer bridge, and rolling trade journal.

## Current phase

**P0/P1: Observer + Shadow AI**

No live or demo order execution exists in the current build. The system can ingest market data, expose it through MCP, journal structured AI decisions, validate them with deterministic risk rules, and record outcomes for analysis.

## Production

- Base URL: `https://tradevice-api-production.up.railway.app`
- Health: `/health`
- Status: `/api/v1/status`
- MCP: `/mcp`

Protected endpoints use:

```text
Authorization: Bearer <TRADEVICE_API_KEY>
```

Keep the key out of Git and source files.

## MT5 observer setup

1. Open MetaTrader 5.
2. Copy `mt5/TradeviceObserver.mq5` into `MQL5/Experts/`.
3. Compile it in MetaEditor.
4. In MT5 go to **Tools > Options > Expert Advisors**.
5. Enable **Allow WebRequest for listed URL**.
6. Add:

```text
https://tradevice-api-production.up.railway.app
```

7. Attach `TradeviceObserver` to an XAUUSD chart.
8. Set `ApiKey` to the Railway `TRADEVICE_API_KEY` value.
9. Keep AutoTrading state irrelevant for this observer build: it contains no order placement functions.

The observer sends one snapshot when a new M1 candle starts, using completed candles only:
- 60 x M1 execution candles;
- 36 x M5 context candles;
- 16 x M15 context candles;
- bid/ask/spread;
- balance/equity/free margin.

## MCP tools

- `get_market_snapshot`
- `get_recent_decisions`
- `get_performance_summary`
- `submit_shadow_decision`
- `record_trade_outcome`

## Shadow decision contract

The AI must choose one of:

```text
WAIT
PLACE_PENDING
CANCEL
```

For `PLACE_PENDING`, V1 uses only these setup families:

```text
TREND_PULLBACK
BREAKOUT_RETEST
LIQUIDITY_SWEEP
```

The Risk Governor then checks the order independently before the idea is considered research-valid.

## Persistence

When `DATABASE_URL` is configured, Tradevice automatically creates its PostgreSQL journal tables. Until then it uses bounded in-memory storage, which is suitable only for bootstrap testing because data resets on a service restart/deploy.

## Next milestones

1. Attach persistent Railway PostgreSQL.
2. Add shadow outcome simulator that follows pending orders candle-by-candle and records MFE/MAE automatically.
3. Add AI decision worker triggered after each accepted M1 snapshot.
4. Run a minimum shadow sample before demo execution.
5. Add deterministic lot sizing, daily loss ceiling, exposure limits, slippage guard, heartbeat, and kill switch.
6. Add a separate MT5 execution EA only after shadow validation.

See `docs/architecture.md` for the full flow.
