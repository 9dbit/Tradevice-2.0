# Current ATR as basket profit USD — 15 October 2026 correction

Supersedes the frozen price-distance policy in ATR_PRICE_DISTANCE_20261015.md. Only the isolated V5.1 clone and staging are in scope. No cycle/order execution is authorized by maintenance.

- ATR14 uses the latest validated completed M1 candle, refreshed during the cycle. 1× ATR 4.00 means a $4.00 basket profit target; a later ATR 3.10 changes it to $3.10. 2× uses twice that USD number. It is independent of basket lot volume, not a fixed price distance and not a $30 cap. Subcent ATR is retained internally; UI formats USD.
- Hard basket loss: ATR_1 −$250; ATR_2 −$350; fixed $3.50/custom −$250. The actual basket loss guard still exits. Execution can realize a different amount due to price movement, costs and rounding.
- L6–L10 keep the strictly >1,700-point completed-M1 adverse distance from the preceding actual fill. Existing lot formula/multiplier, 10-layer limit, durable candle proof/60s expiry, identity, ownership, spread, news, broker order_check and no ambiguous resends remain. Projected stress does not shrink/reject the requested adaptive lot; the research 1/1.5/2-ATR stress veto and extra margin reserve veto are removed for the new registered protocol only. Baseline V4/V5 configurations retain their policies.
- Current positions and pending TP values are synchronized. Pending ticket, entry price, stop-limit activation, expiry and lot are preserved. Missing orders are never recreated. A failed/ambiguous modification remains blocked pending reconciliation. Invalid/stale ATR retains existing protection and prevents a new adaptive entry; a heartbeat never renews the ATR candle.
- Dynamic USD exit compares exact executable basket P/L with the current target. TP history requires owned, fully closed volume and broker TP price/reason proof. Manual close cannot become an ATR TP. Partial volume/late fill cleanup still requires flat reconciliation.
- Protocol V51_DYNAMIC_ATR_USD_20261015 blocks new Start on an older engine. Earlier heartbeats remain readable during rollout. Old command settings/receipts are immutable.

## Manual-close reconciliation

Audit of cycle ec57f7a6: five owned entries and five manual exit deals, exact matched volumes 0.01/0.02/0.03/0.05/0.08, broker reason 0, net +$8.96, no unresolved requests, empty positions/orders. Historical SAFETY_STOP retained an intermediate −$2.56 and false flat status. The one-shot repair verifies exact fingerprint/manifest, identity, ledger chains, full deal volume and net twice, stable file hashes and broker-flat twice. It backs up SQLite, adds a recovery_audit record, and clears only the proven stopped active-run pointer. A separate read-only batch projection reports COMPLETE_MANUAL_CLOSE_RECONCILED and +$8.96. Original journals/manifests/summaries/receipts are not rewritten. No old batch resumes; a fresh authorized Start is required.

## Validation

67 engine/candidate/settlement tests and 7 subtests; 67 bridge/reconciliation tests; 176 API tests; 158 web unit tests; production build; 3 browser tests for current ATR USD, mode-specific loss, settings and telemetry continuity. Synthetic broker only, no real order test. Earlier price-distance-only tests are retained under archive because that policy is superseded; their results are not presented as dynamic-policy validation. The historic 738-test regression is not claimed resolved.

Nine exact patches reconstruct the tested candidate from installed fingerprint 00b438dfc08c2a525a03b1469178e376fdcbd0fadeffff313b6aa97da46d34e2. Use the existing guarded installer only after API SUCCESS and the reviewed manual-flat reconciliation. Preserve backups and journals.
