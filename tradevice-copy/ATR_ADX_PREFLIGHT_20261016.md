# ATR/ADX new-cycle preflight — 16 October 2026

Scope: isolated V5.1 demo clone and staging API/dashboard. No orders or new
cycles are sent by this rollout. Original V4/V5 and production remain unchanged.

## Research policy

- ATR14 M1 = simple mean of the latest 14 true ranges, matching engine ATR.
- Allowed ATR = inclusive P20–P60 of the preceding 1,440 valid ATR observations;
  the evaluated candle is excluded. Quantiles use linear interpolation.
- ADX14 uses Wilder smoothing. Both M1 and M5 must remain strictly below 20
  over their own latest three completed candles (3 M1 and 3 M5 candles).
- M1 fetch: 1,600 bars; minimum 1,455 completed bars. M5 fetch: 300 bars;
  minimum 200 completed bars for smoothing warm-up.
- Forming candles excluded. Latest completed timestamp must equal the current
  timeframe boundary; recent 32-bar gaps, duplicate timestamps, malformed or
  nonfinite data fail closed. No fallback to a falsely refreshed cache.
- The current ATR value is a price-distance measurement, not the basket TP USD.
- This is a research filter; no profitability, range persistence or loss-limit
  guarantee follows from passing. These thresholds are not outcome-optimized.

## Execution boundaries

The runtime checks this policy in the read-only preflight and after the existing
calendar/telemetry/capacity admission waits before every new cycle. It is NOT
inserted into the active basket's news provider, adaptive entries, supervision,
TP, hard-loss exit or emergency-close path. Once broker pending orders are
armed, this patch does not cancel them when ADX/ATR changes.

An explicit false admission returns without creating a first cycle, or stops the
batch as STOPPED_ENTRY_PREFLIGHT before reserving the next slot. Broker-flat is
still required. Prior cycles have already completed reconciliation. The batch
will not resume automatically; a fresh explicit Start is required. Other
exceptions retain the original recovery-required behavior.

## Protocol and UI

- New boolean preflight checks: atr, adx (12 dashboard rows including Engine ready).
- Signed preflight evidence includes actual ATR/points, allowed interval, current
  ADX M1/M5, maxima of the last three values, closed timestamps and policy ID.
- The API accepts old reports and historical receipts during rolling deployment;
  missing new checks cannot authorize Start. It validates market evidence types,
  policy, time boundaries, formulas for pass/fail and bounded numeric values.
- Requirements & solutions displays actual values/requirements and actionable
  reasons. Graceful market-filter batch stops have a dedicated explanation.
- No database migration is needed; existing JSON diagnostic fields are used.

## Validation before rollout

- 171 web tests and production build passed.
- 31 API demo-control tests passed. A timestamp fixture was made deterministic
  (snapshot and validation use the same time); assertions were retained.
- 67 engine/bridge tests and 9 subtests passed, including emergency/recovery
  controls, read-only calculation, current-candle exclusion, history validation,
  and admission rejection before a first/next cycle.
- Read-only MT5 sample at 21:24:26 WIB: ATR 3.39793, allowed 1.20099–1.66906;
  ADX M1 43.77255 / M5 29.45130. Both entry filters correctly blocked.
  Calculation took 15 ms; no broker writes.
- Installer --check passed against fingerprint
  5aada8f2977ecc812f1b71dcac88a85a922ee59ecccaaebbd80217286ad88697,
  zero positions/orders, no active run or unsettled command.

## Rollout

Deploy copy-api compatibility before installing the isolated clone package;
copy-web displays the two checks and numeric diagnostics. The installer verifies
all pinned sources and the exact replacement hashes, requires stopped bridge
and observer tasks, takes the broker lock, backs up changed sources, and verifies
all existing journal hashes. Restart only the bridge and read-only observer.
No START, skill activation, emergency-close or broker command is part of rollout.
