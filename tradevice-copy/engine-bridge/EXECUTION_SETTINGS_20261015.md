# Closed-M1 distance policy and dashboard basket settings

> ATR numeric-USD behavior below is historical and superseded by `ATR_PRICE_DISTANCE_20261015.md`.

Only the isolated V5.1 research clone and staging platform are in scope. This change does not authorize a run, change selected skills, or dispatch an order.

## Audited incidents

Batch `v51_dashboard_483efdc67c3f44048fcebe0e3fac8646`, cycle `950d2bf7`: BUY L1 was filled with L2–L5 pending. At 16:12:42 WIB the one-hour batch entry deadline was forwarded as an UNKNOWN news decision and retired those pending orders. L1 remained supervised until a manual broker close at 16:15:08 WIB (DEAL_REASON_CLIENT, net $1.86). The batch completed 9/10 and stopped. This is the cause of the reported single-position/no-pending incident.

Cycle `c8f3bb07`: the 15:50 WIB SELL-adverse close was 1,964 points beyond the actual L5 fill. The previous two-stage reversal policy only armed then; later reversal/distance conditions never coincided. Candle polling was present.

## Revised behavior

- Batch entry deadline blocks admission of a new cycle. It never retires an already owned active recovery ladder. Actual news blackout, operator Pause/Stop, connection/safety suspensions retain their existing behavior.
- L6–L10 accept a completed M1 candle whose adverse close is strictly greater than 1,700 points from the previous actual fill. Continue evaluating each subsequent closed candle until qualified, without an arm timeout or reanchor. Reversal and body-quality thresholds are not entry gates for this policy. Body/ATR still sizes the adaptive multiplier.
- Dispatch is at the next executable quote after the closed candle. Historical candle-close fill price is not guaranteed.
- Durable authorization expires in 60 seconds. Ownership, identity, quote, spread, stress reserve, live margin, ambiguous-response reconciliation, hard-loss and broker-flat completion safeguards remain.
- Hard basket loss: −$250 for the new settings protocol. This is a trigger, not a guaranteed realized loss cap.
- Base lot: 0.01–0.10, discrete 0.01 steps. A larger dropdown choice can fail margin or risk checks.
- TP: fixed $3.50; numeric ATR14 M1 in USD; twice numeric ATR in USD; custom $0.01–$250.00 with two decimal precision. ATR is sampled at admission from validated closed M1 bars, rounded to cents, and frozen per cycle. Example ATR 2.10 means $2.10 / $4.20, independent of lot.
- Command settings are persisted in the private command row and bridge receipt. A repeated request ID cannot change settings. Per-cycle effective settings/proof are written before orders. Existing baseline JSON/spec digest and old journals remain unchanged.
- API requires capability `V51_CLOSE_DISTANCE_20261015` for new Starts. Old bridge heartbeat and legacy Pause/Stop bodies remain readable during rollout. No fallback executes a Start without settings.

## Installation

Apply the additive SQL migration before deploying copy-api. Publish the reviewed web/API changes, verify deployment success, then install clone patches while broker-flat, bridge idle and no unsettled commands. `apply_execution_settings.py` requires exact prior fingerprint `57abe0d56c91316cb9b34327e31aadfdf3b3b648321633784bc34ae741becba2`, checks every current fingerprint entry, acquires bridge and runner locks, reads broker identity/book twice, preserves source backups and replaces the fingerprint only after all byte-checked patches are installed. It never edits journals or receipts and never starts a cycle.

The patch package contains diffs only; the private original engine is not copied into this repository. A new settings factory registers immutable reviewed overrides while preserving the baseline digest for historical journals. Engine startup still requires a fresh authenticated user Start.

## Validation

- 172 API tests.
- 58 bridge, bounded runner, reconciliation and risk-stop tests (synthetic MT5).
- 37 new-distance/settings and V5 candidate compatibility tests, plus 7 subtests.
- 156 web unit tests, production build and focused mobile/settings browser checks.
- Installer dry-run recreates all 10 tested candidate files byte-for-byte from audited baseline hashes.

Tests exercise delayed candle qualification, both directions, actual-fill anchoring, reserve rejection despite a passing distance, hard-loss preemption, no ambiguous resend, authorization expiry, frozen ATR, command idempotency, deadline ladder continuity, and truthful diagnostics. No broker execution test is performed. The old 49 legacy failures/errors and the separate $3.49 TP classification issue are not claimed fixed by this change.

## Installed verification (15 October, about 17:54 WIB)

- copy-api deployment `e2e8497a-9e65-4881-aff8-043d1abee340` and copy-web `618c6100-c16d-4932-b9ad-7ebfd9830e8c`: SUCCESS on `f55b68472436282042dcba50153cd41c881fd070`. Public API health and `/master` HTTP 200; eight served web scripts match the tested local build. Platform remains paper, live/copy execution false.
- Clone installation fingerprint: `722c23673123128a2afe098aba2d29e905af595478246bba804684beea240ae6`. All ten installed file hashes match the tested candidate. All 123 existing journal files remain byte-identical.
- Windows refused atomic source replacement before any source mutation. The installer now preserves existing file ACLs with flushed writes under both execution locks, refuses hardlinked source files, verifies bytes, then commits the fingerprint. No ACL or security configuration was changed. The failed attempt and successful attempt have separate preserved backups.
- Read-only preflight: identity, broker-flat, quote, spread, margin, commission, news, reconciliation and engine fingerprint all passed. Four TP modes validated on the installed source; observed ATR target $1.16/$2.32 at that instant. Broker remained 0 positions / 0 orders; no cycle started by installation.
