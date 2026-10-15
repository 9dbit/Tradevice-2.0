# Staging demo emergency close

Adds an authenticated, explicitly confirmed `EMERGENCY_CLOSE` command and a red English dashboard control outside the collapsible Trading Cycle panel. Scope: verified TRADEVICE XAUUSDm exposure on the pinned demo identity. Cancel all owned pending orders, refresh for fills, then close owned positions at market. Foreign exposure/unknown ownership fail closed; no unrelated account-wide adoption.

The command is independent of selected skill, news, entry readiness and kill switch. A known compatible bridge protocol is required. Queued authorization expires after 60 seconds. Offline, hung engine, unavailable MT5, expired authority and uncertain broker receipts remain visibly unconfirmed. This is not an out-of-band network bypass.

The PC durably records the close intent before execution. A persistent entry latch cooperatively hands off the running strategy, retaining the same OS broker lock. No lock stealing or process killing. The reduction adapter allows only CANCEL/CLOSE, retaining demo identity, ownership, quote, durable ledger and exact-effect reconciliation checks. Authorization is rechecked immediately before dispatch. Ambiguous responses never blindly resend.

Success requires two empty broker books, matching exact-volume deal history, no unresolved emergency/original requests, stable original state/journal hashes, a durable close proof and an additional empty-book/history verification. Original journals are preserved. A cancelled unfilled cycle has a separate bound proof instead of fabricated closed deals. A subsequent explicit emergency can reconcile an interrupted close; unrelated uncertain commands remain blocked. Batch continuation is permanently stopped; another batch requires explicit Start and normal preflight.

The UI keeps its request ID through a lost HTTP response/reload. A verification retry reuses that ID. It displays Pending / Closing / Connection unavailable / Reconciliation required / Broker-flat verified; HTTP acceptance alone is never success. No broker-close command is sent by installation or testing.

Also closes the outer batch guard gap in the previously reviewed pending activation fix: only an exact PENDING_MODIFY 10013, resolved with proven no effect and a durable matching PENDING_TRANSITION_DEFERRED event can continue. All other definitive rejection and partial effect still stop the batch.

## Validation

- 113 focused offline engine/controller tests passed (synthetic MT5 only).
- 35 focused API tests passed.
- 160 web unit tests and production build passed.
- 3 browser checks passed: notched layout, offline confirmed close with reload/proof, lost-response idempotency. No real broker action.
- Seven patch files reconstruct the candidate byte-for-byte through the guarded installer.
- Staging database migration adds only the private command enum/check; RLS and grants unchanged.

## Deployment order

1. Apply `20261015165015_master_demo_emergency_close.sql` to staging (applied and RLS verified).
2. Deploy this commit to copy-api and copy-web; observe exact-commit SUCCESS.
3. Recheck idle, flat broker, no active run/unsettled receipts. Stop the standby bridge, take bridge/runner locks, install `patches/20261015_emergency_close` with `apply_execution_settings.py`, fingerprint last, restart standby bridge.
4. Verify compatible signed snapshot, source hashes, unchanged historical journals and public asset/health. Do not send an actual emergency command merely to test.

Baseline fingerprint: `73ee018fb6191e8d8b7894d4e3845e8a97dd99ff46fa03d30f7093d970f8a9b4`. V4/V5 originals and production are untouched. Platform remains paper, broker-live false, copy execution false. Test/build success is not evidence of profitability or guaranteed connectivity.
