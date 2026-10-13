# Staging MT5 read-only observer ingestion

This branch adds **display telemetry only** for the Tradevice Master Trader Control Center. It does **not** add a trading execution adapter or connect to the worker's quote admission.

- Windows research clone owns a one-shot read-only MT5 observer. It verifies Exness-MT5Trial14 DEMO, the locked account suffix, XAUUSDm, last 15 completed contiguous M1 candles and current tick age. It persists only a sanitized local JSON snapshot.
- Separate, dedicated `MASTER_OBSERVER_SHARED_SECRET` is required by `copy-api` staging. Do not reuse `MASTER_TELEMETRY_SHARED_SECRET`. Send `x-tradevice-observer-time` (13-digit UTC milliseconds) and `x-tradevice-observer-signature` (HMAC-SHA256 over timestamp + newline + exact JSON body) to `POST /internal/master/observer`.
- Before accepting an observation, the server validates the HMAC and age, JSON integrity, pinned DEMO identity, candle/quote freshness, spread arithmetic, fixed cost/news unknown fields, read-only flags and replay duplicates.
- Accepted snapshots are stored **in memory only** on one `copy-api` process. There are no SQL writes, RLS changes, system orders, runner restarts, or order APIs. Restart, 9-second expiry, horizontal replicas, missed uploads, wrong signatures and malformed data all fail closed to `NOT_CONNECTED`.
- The internal master telemetry route projects accepted observations to authenticated Master Admin Dashboard via the existing service-to-service secret. Commission/slippage stay unavailable; the dashboard labels values `DEMO · READ-ONLY`.
- **Trade admission never depends on the observer.** `quotesReady`, `brokerReady`, `newsCalendarReady` are forced false in the web projection; broker execution stays `INTERNAL_PAPER_ONLY`. `Start Cycle` remains disabled.

## Operational requirements and limitations

Deployment of the route without the dedicated secret remains **503 / MASTER_OBSERVER_NOT_CONFIGURED** for ingestion and is safe. Do not put secret values into chat or repo. Do not turn on the uploader until HMAC tests, Railway and authentication checks pass.

Observe from the active Windows session only. A one-shot snapshot may expire before a person opens the dashboard; do not present it as continuous telemetry. Continuous read-only service, signed forwarding, secret distribution, multi-replica storage and provider attestation require separate verification.

HMAC authenticates the sender, **not** the truth of its terminal clock or data if the sender is compromised. Report cost, commissions, calendar, slippage and trade readiness as unknown until independent evidence exists.

This route must never accept `START`, `order_send`, database writes, credentials or position-closing instructions.
