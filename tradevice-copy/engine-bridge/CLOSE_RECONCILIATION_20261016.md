# Completed Close all left the prior cycle in recovery

## Observed cause

Batch `713456b2-71f9-4c3a-a776-56bd0e7d81df`, cycle `e12c4d92`, stopped on rejected cancellation 10029. The original ledger correctly retained that cancellation as unresolved: an observed fill conflicted with a definitive cancel rejection. The broker's historical order later had magic 0 and an empty comment, while its exact entry deal retained the strategy magic, cycle comment, order ticket, side and volume.

Two explicit account Close all requests were APPLIED and the account was empty, but the strict order-metadata check omitted this cycle from reconciliation evidence. `active_run` remained set. On bridge restart, recovery also prevented acknowledgement of the existing selected skill, producing the secondary SKILL_ENGINE_ACK_MISMATCH blocker.

## Change

- A missing-metadata fallback applies only to filled historical orders with magic 0 and an empty comment. It requires one matching accepted placement receipt, the original EFFECT_PROVEN ticket, exact owned entry deals, matching volume and side, and fully closed lifecycle. Conflicting metadata, unknown broker receipts and other reject codes do not qualify.
- After an APPLIED account Close all, an idle bridge may automatically reconcile its terminal prior run. It requires completed account-reduction evidence, no unresolved control/account requests, valid fingerprint and identity, repeated empty broker books, closed history and unchanged original journals.
- New immutable proof files and a separate hash-chained audit journal record reconciliation. The SQLite active pointer is retired transactionally. No historical trading journal or command receipt is rewritten; no broker order is dispatched.
- A stopped batch never resumes. Existing skill selection can be acknowledged again, but every new Start still requires explicit user action and all admission checks, including news.
- A manual bypass/resolve button is intentionally unnecessary for this proven completion path. Incomplete evidence remains blocked.
- Basket & Adaptive shows Reconciled only when a fresh matching Close all completion and current reconciliation check supersede the old suspended engine report. News admission remains independent. Historical targets remain labeled as historical.

## Verification and installation

113 local tests passed. Thirteen Windows unittest checks passed (ten overlap the local bridge tests, three additional mocked runtime risk-stop checks). Initial Linux runtime risk-stop execution could not import Windows-only MetaTrader5; those checks passed on Windows instead.

Read-only proof against actual broker history succeeded before installation. The affected cycle's aggregate closed P&L was -1.74 USD across ten closed positions; this is not ten cycles. All 144 original journal files retained their hashes.

Installed only in `GoldTrapCore_v0.2_v51_research_20261013`, using verified pre-change fingerprint and backup/rollback installer. DemoBridge and ReadOnly-Observer were briefly stopped and restarted; no new control commands were issued.

Previous fingerprint: `b629ab7c2a5aad9bdae51fcdf7f621a51ba0cd6f97eeaf37dc9f73b31440052d`.

Installed fingerprint: `b723859fa6ccc649e52cd507b99956663edb569ac58e29a03dd77194bd2ed50f`.

At 16 October 2026 09:41 WIB: active_run NULL, no unsettled local receipts, brokerFlat=true, reconciled=true, engineHash=true, selected and acknowledged skill revision both 1. Runtime recovery blockers cleared; PREFLIGHT_NEWS remained. Batch projection is STOPPED with OPERATOR_EMERGENCY_CLOSE. The audit records orders_sent=0 and new_cycle_started=false. No claim of profitability or admission readiness follows from these tests.
