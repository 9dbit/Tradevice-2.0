# Tradevice 2.0

AI-assisted XAUUSD scalping research stack with an MCP server, deterministic risk governor, MT5 observer bridge, shadow execution simulator, rolling trade journal, and feature-flagged AI decision worker.

## Current phase

**P0/P1: Observer + Shadow AI**

Live order execution is intentionally disabled. The system can ingest market data, expose it through MCP, journal structured AI decisions, validate them with deterministic risk rules, simulate pending orders candle-by-candle, track MFE/MAE, and record outcomes for research.

## Production

- Dashboard: `https://tradevice-api-production.up.railway.app`
- Health: `/health`
- Status: `/api/v1/status`
- Public feed telemetry: `/api/v1/dashboard`
- MCP: `/mcp`
- MT5 observer download: `/downloads/TradeviceObserver.mq5`

Protected endpoints use:

```text
Authorization: Bearer <TRADEVICE_API_KEY>
```

Keep the key out of Git and source files.

## MT5 observer setup

### Optional demo pending executor (off by default)

The separate `mt5/TradeviceDemoExecutor.mq5` bridge supports approved, ready pending proposals with confidence **strictly above 80%**, numeric scenario invalidation, native expiry, and a separate persistent demo ledger. It refuses real/contest accounts and never closes filled positions. `WAIT` decisions do not become orders, regardless of confidence.

Read [demo setup, limits, failure behavior and required MT5 acceptance checks](docs/demo-pending-execution.md) before enabling it. The existing observer still sends data only. Server flag `DEMO_EXECUTION_ENABLED=false` and EA input `EnableDemoOrders=false` are the defaults.

### Observer installation

1. Open the Tradevice dashboard and download **MT5 Observer**, or copy `mt5/TradeviceObserver.mq5` from this repository.
2. In MetaTrader 5 open **File > Open Data Folder > MQL5 > Experts** and place the `.mq5` file there.
3. Compile it in MetaEditor.
4. In MT5 go to **Tools > Options > Expert Advisors**.
5. Enable **Allow WebRequest for listed URL**.
6. Add:

```text
https://tradevice-api-production.up.railway.app
```

7. Attach `TradeviceObserver` to an XAUUSD chart.
8. Set `ApiKey` to the Railway `TRADEVICE_API_KEY` value.
9. AutoTrading does not control this observer build because it contains no order placement functions.

The observer sends one snapshot when a new M1 candle starts, using completed candles only:
- 60 x M1 execution candles;
- 36 x M5 context candles;
- 16 x M15 context candles;
- bid/ask/spread;
- balance/equity/free margin internally;
- positions/order counts;
- bridge version and terminal build telemetry.

The public dashboard never exposes account balance/equity data.

## Feed health

The dashboard classifies the MT5 connection as:

```text
WAITING     no market snapshot has arrived
CONNECTED   latest snapshot is fresh
STALE       a snapshot exists but is older than FEED_STALE_AFTER_SECONDS
```

Default stale threshold: 180 seconds.

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

The deterministic Risk Governor independently checks spread, order geometry, SL/TP direction, and minimum reward/risk before a pending idea is considered research-valid.

## Shadow simulator

Each accepted M1 snapshot advances virtual pending orders. It tracks:
- pending fill;
- expiry;
- TP / SL;
- MFE;
- MAE;
- R-multiple outcome.

If both SL and TP fall inside the same OHLC candle and tick order is unknown, the simulator records the conservative SL-first outcome. Exact sequencing will require tick replay later.

## AI decision worker

The AI decision worker is implemented but feature-flagged off by default:

```text
AI_DECISION_ENABLED=false
AI_MODEL=gpt-6-astra
```

It uses structured model output and cannot directly place MT5 orders. After a decision is generated it still passes through the Risk Governor and shadow simulator.

## Persistence

When `DATABASE_URL` is configured, Tradevice automatically creates its PostgreSQL journal tables. Until then it uses bounded in-memory storage, suitable only for bootstrap connection testing because data resets on service restart/deploy.

A dedicated persistent PostgreSQL service remains the current infrastructure gate before collecting the real 20/50/100/250-trade research dataset.

## Railway runtime

Production has:
- `/health` healthcheck;
- application sleeping disabled;
- restart on failure with bounded retries;
- public Railway domain;
- live execution disabled.

## Next milestones

1. Attach dedicated persistent PostgreSQL and verify `store=postgres`.
2. Attach `TradeviceObserver.mq5` on the MT5 VPS and verify dashboard feed changes to `CONNECTED`.
3. Configure OpenAI API credentials and enable AI decisions only in shadow mode.
4. Collect the first 20 shadow decisions and review false positives, missed opportunities, MFE/MAE, setup, regime, and session performance.
5. Add tick capture/replay for more accurate intrabar simulation.
6. Add demo execution with deterministic lot sizing, daily loss ceiling, exposure limits, slippage guard, kill switch, and separate MT5 execution EA only after shadow validation.

See `docs/architecture.md` for the full flow.
