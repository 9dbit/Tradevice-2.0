# Intentional risk stop misclassified as engine recovery

Audit confirmed the batch core intentionally raises ArcSafetyError('Risk exit/arm rollback: no subsequent batch cycle') after a completed risk exit. Runtime propagated it; the bridge generic handler set recovery and retained active_run. A second generic recovery label incorrectly suggested process restart.

Fix: the runtime handles only this exact ArcSafetyError, then independently verifies demo identity, the matching terminal batch/cycle, unchanged journals, resolved request ledger, full closed broker history, and two empty broker-book reads. Only a proved COMPLETE_RISK_EXIT returns RISK_STOP_FLAT. Bridge then retires active_run and stops. Other exceptions, rollback, unfinished cycles, and ambiguous broker results remain blocked. A new cycle still requires a new authenticated START; this does not resume the old batch.

Installed on isolated V5.1 clone after old fingerprint verification. Reviewed manifest extended for the new reconciliation module. Previous files, fingerprint, and SQLite backed up in read_only/recovery_fix_20261015/before_install. No V4/V5 original changes.

One-time reconciliation: request 8778cc63-6c81-42d8-b02d-eb1a099117e0, cycle 957ee500, BUY, five layers, -122.89 USD. Exact terminal history and fresh broker-flat proof passed. Old manifest and journals untouched. APPLIED receipt preserved; active_run retired in a transaction with recovery_audit evidence. No orders or new cycle dispatched.

Validation: 44 local bridge/proof tests passed; 19 clone proof/contract tests passed (12 overlap the local set), plus 3 mocked runtime integration tests passed on TRADEVICEPC. Total 54 unique checks. Reconciliation against actual broker history passed read-only.

New reviewed fingerprint: 68337658ccddc2d2eaf7f4561d7068bd18167d8606f6770155da5218a27a4cc7.
