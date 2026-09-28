# Demo pending orders: confidence strictly above 80%

This feature is **off by default**. It is a separate demo execution journal alongside the existing shadow simulator. It never enables real-account trading. Model confidence is a model score, not a measured probability of winning.

## Decision and monitoring rules

- Only an approved `PLACE_PENDING` with `confidence > 0.80` can be dispatched. `WAIT` at 83% or 100% remains WAIT. Exactly 80% is excluded.
- Entry, SL, TP, expiry, numeric scenario invalidation and `pending_trigger=PRICE_TOUCH` are mandatory. Legacy decisions lacking these fields are excluded.
- `PRICE_TOUCH` means all candle/rejection confirmations have already occurred. If confirmation is still needed, the AI must return WAIT. A broker pending order can fill as soon as its price is reached; polling cannot guarantee a cancellation will beat a fill.
- Revalidate fresh market data, confidence, review, order geometry, spread <=300 points and reward/risk >=1.5. Feed and original analysis must be no older than 90 seconds at dispatch. The EA independently rechecks current broker prices.
- Demo lot is fixed at 0.01; maximum one order/position on the account. Existing manual/other-EA exposure blocks a new Tradevice order. There is a 60-second cooldown after an execution journal update.
- EA risk caps: planned SL loss <=1% of equity, daily equity drawdown <=3% from the first executor observation of that UTC day. Both caps can be reduced but cannot be increased by EA inputs. Costs, gaps and slippage can exceed the planned loss.
- Numeric invalidation is checked locally every timer cycle (nominally 2 seconds, plus network latency). The AI receives active pending plans on each new M1 snapshot and can issue a targeted CANCEL when its scenario changes. An unrelated WAIT or unrelated CANCEL does not delete an order.
- Cancel an owned pending on scenario invalidation, expiry, targeted AI cancellation, disabled executor, stale feed, or lost server heartbeat for >60 seconds. A cancellation remains requested until the broker confirms it.
- Filled positions are never closed by this feature. A fill racing a cancellation is reconciled as FILLED; its attached SL/TP remain the protection.
- Native `ORDER_TIME_SPECIFIED` expiry is mandatory. Symbols/brokers without it are rejected; there is no silent GTC fallback.
- Only this EA's magic number, symbol and `tv2:` comment scope can be deleted. Manual orders and other EAs' orders are not removed.

## Installation and activation

1. Deploy this code with `DEMO_EXECUTION_ENABLED=false`. Keep the existing MT5 Observer running on its chart.
2. Compile `mt5/TradeviceDemoExecutor.mq5` in **MetaEditor 5**. Do not proceed unless it compiles successfully. Compilation/broker validation must be done in the actual Windows MT5 installation; Node tests cannot establish MQL5 compilation or broker compatibility.
3. Open a separate XAUUSDm chart in the **demo account**. Attach Demo Executor there; leave Observer on the original chart. Real and contest accounts fail initialization.
4. Set `ApiBase` to the Tradevice API host and `ApiKey` to the existing API key in MT5 inputs. Do not embed it in source or Git. Allow that HTTPS host in MT5 WebRequest settings.
5. Set a stable, unique `ClientId` (default `mt5-demo-1`). Use one executor terminal for the account. Leave `EnableDemoOrders=false` while checking connectivity.
6. Configure the server's `DEMO_ACCOUNT_LOGIN` and `DEMO_ACCOUNT_SERVER` to the exact demo login/server shown in MT5. The same `TRADEVICE_API_KEY` and PostgreSQL `DATABASE_URL` must already be set.
7. After compilation, broker-expiry support and correct account binding are verified, the operator can set `DEMO_EXECUTION_ENABLED=true`, set `EnableDemoOrders=true` in the EA, and enable MT5 Algo Trading. The first eligible fresh proposal will then place a demo pending order automatically.
8. Inspect the new **MT5 Demo Orders** panel for the actual broker ticket, pending/fill/cancel state, cancellation reason and final reported P/L. Existing shadow results remain a separate journal.

No account binding or execution flag is turned on by installing/deploying the source alone. No old screenshot plan is seeded as a current order.

## Delivery, reconciliation and failure behavior

`POST /api/v1/demo/poll` requires authentication, exact account binding and PostgreSQL. It returns a fixed 15-field text protocol with a request nonce and response timestamp. Place commands older than 15 seconds are ignored by the EA. Prices and all guards are rechecked at the terminal.

PostgreSQL advisory locking serializes reservations. Each decision has one unique durable token; PLACE is delivered at most once. The EA persists its token before contacting the broker and searches current/history orders to reconcile an uncertain broker response. Repeated polling, restarts and concurrent clients do not authorize replay.

If the HTTP response is lost after the server reserves an order, the row can remain `DISPATCHED`/`UNKNOWN` with `RECONCILE_REQUIRED`. This intentionally blocks further orders. Inspect MT5 current orders and history before an operator repairs the journal; do not delete a journal row or change the client ID to force another dispatch. No automatic retry can safely assume the first send failed.

The EA state file is stored under the terminal's `MQL5/Files/TradeviceDemo_<account>_<server>_<magic>.csv`. Keep it across restarts. Cancellation may be delayed by network, disabled Algo Trading, broker freeze levels, disconnection or market closure; native expiry provides the independent time limit.

## Tests and remaining acceptance gate

- `npm test`: boundary confidence, WAIT behavior, missing confirmation, stale/future data, risk/price geometry, expiry and targeted cancellation.
- CI uses a disposable local PostgreSQL database for concurrent dispatch, restart persistence, sticky cancellation and a fill racing deletion. To run that test locally, set `DEMO_TEST_DATABASE_URL` to a localhost database whose name ends with `_test`.
- Required MT5 acceptance: compile in MetaEditor; confirm real-account refusal; place one demo pending; invalidate and delete it; verify a filled order is not closed by CANCEL; disconnect and confirm expiry; restart and confirm no duplicate order. These checks require the user's MT5 terminal and have not been replaced by Node tests.

Reference: [MQL5 OrderCheck](https://www.mql5.com/en/docs/trading/ordercheck), [OrderSend](https://www.mql5.com/en/docs/trading/ordersend), [symbol expiration properties](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants).
