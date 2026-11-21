# Tradevice Supertrend M1 Research Observer

## Status, 21 November 2026
Local MQL5 source and compiled EX5 files are installed on TRADEVICEPC, in its normal terminal data folder. Both MetaEditor builds report 0 errors and 0 warnings. The separate template and profile have been written, but NOT attached to the running MT5 chart.

The running MT5 title reported PepperstoneUK-Demo with XAUUSD,H1. Session 2 is disconnected; a read-only MT5 bridge check failed with Terminal: Authorization failed. We did not restart MT5, alter the existing chart, activate Automatic, or send any order.

## Local files
Data folder: C:\Users\MARKSTUDIOS\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5

Indicator: Indicators\TradeviceResearch\Tradevice_ST_TV_Observer.mq5 and .ex5
Observer: Experts\TradeviceResearch\Tradevice_ST_Observation_EA.mq5 and .ex5
Template: Profiles\Templates\Tradevice_ST_Observer_M1.tpl
Profile: Profiles\Charts\Tradevice_ST_Observer_M1\chart01.chr

Source indicator is based on the existing TradingView Pine v4-style MQL5 Supertrend conversion: HL2, Wilder ATR10, multiplier 3.0. This parity is not yet verified against the user's original TradingView script, and is not the separate Pivot Point Supertrend logic.

Observer default timeframe M1; confirmed closed-candle signals and optional intrabar line crosses. Every completed M1 candle gets a numeric JSON observation. Each signal gets numeric ADX14 (+DI/-DI), ATR14, EMA50, RSI14, relative tick volume, Bollinger width, spread, candle body/wicks, H1/H4 Supertrend context, and a requested chart screenshot. Separate 1/3/6-bar subsequent outcomes record observed forward prices and excursions, NOT trade fills or P/L.

Local record path is MQL5\Files\TradeviceST (candles, events, outcomes, shots, events.jsonl, pending.csv). New records start on future ticks only; no retroactive signals or made-up screenshots.

## Safe activation once remote Windows session is reconnected
1. Confirm the account and symbol with the actual MT5 terminal. The visible title currently shows XAUUSD, not XAUUSDm.
2. Open a NEW XAUUSD M1 chart. Do not replace any running trade chart.
3. Apply Tradevice_ST_Observer_M1.tpl from Templates. Alternatively manually attach the indicator and the Tradevice_ST_Observation_EA to the new chart.
4. Verify the on-chart RESEARCH OBSERVER / NO TRADING panel, terminal Experts and Journal, and event/candle files after the first new completed M1 candle.
5. Never turn on live order execution for this observation-only package.

## Dashboard (isolated GitHub feature branch, not production)
The branch provides private PostgreSQL storage for complete M1 candle and break-event features, 1/3/6-bar outcomes, and chart screenshots. Browser page: /research-supertrend.html. Authenticated endpoints: /api/v1/research/supertrend/candles, /events, /outcomes and /images/:id.

Persistent database requires DATABASE_URL; research authentication requires TRADEVICE_API_KEY. Gateway allows the existing observer key for evidence UPLOAD only; dashboard reads still need the private API key. Uploader scripts/supertrend_research_uploader.py are DRY RUN ONLY by default, and --send requires explicit HTTPS configuration and TRADEVICE_RESEARCH_API_KEY in the environment, never in Git.

No Railway production deployment, database migration, secret changes, or live research upload has been performed. No EA or Automatic existing production settings were touched.

## Interpretation
False breakouts, sideways regimes and conditional favorable excursions are hypotheses, not a reason to send orders. Performance must be evaluated using original historical bid/ask, costs, data quality, independent holdouts, and control against signal-selection bias. Observation cannot be promoted to trading without separate validation.
