# Numeric market regime and faster telemetry

The dashboard displays actual closed-candle ADX14 M1/M5, their last-three maximums, the strict 20.00 entry threshold and the ATR range. Passing ADX does not enable Start by itself. Independent observer evidence is display-only, including during active baskets. Invalid or stale evidence cannot authorize trading.

Cadence targets: engine diagnostics 250 ms (completion emits immediately), MT5 read-only feed 500 ms including work time, bridge/history/journal 1 second including work time, serialized browser overview polling 250 ms. HTTPS connections are reused and failed exchanges are never blindly replayed. Source collection time and delayed data age are shown. Broker-to-device maximum latency is not guaranteed by polling configuration; network, server, tick availability and browser suspension can delay updates. The browser test verifies the close-to-render step with synthetic responses, not a live trade.

The initial loading label is “Starting up the engine”; session verification and monitoring remain the actual operations. Opening the dashboard never sends Start.

Installation: `apply_fast_telemetry.py --check` verifies exact source hashes, full engine fingerprint, no active/unsettled command, expected account and broker-flat. Installation additionally requires four scheduled tasks stopped and the engine runner lock. Backups, rollback on write failure and journal integrity checks are included. The transfer bundle maps each installed path to UTF-8 source content and before/after SHA256 hashes from FILES; its contents are the corresponding bridge, observer-enrichment, terminal-mirror and growth-observer sources in this commit. No credentials are included in the bundle.

Validation: 175 web unit tests, production build, 57 targeted API/bridge tests, 2 synthetic observer transport/cadence tests, and browser checks for 320-pixel layout, visible numeric ADX limits, and completed TP removal within one second of a synthetic response.
