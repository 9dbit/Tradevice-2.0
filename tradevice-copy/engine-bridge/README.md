# Staging demo engine control

The dashboard has a separate authenticated demo lane. The Railway paper supervisor, member copy execution, and live flags are unchanged. Only the isolated TRADEVICEPC clone can access MT5. No uploaded Python or ZIP is executed.

- Skill SELECT uses the existing singleton/revision lock and accepts only the reviewed built-in package fingerprint. The engine loads its local adapter and reports the same skill ID, revision and package hash. A selection receipt is not an activation acknowledgement.
- Start requires an authenticated master admin, explicit per-run demo confirmation, 1–10 cycles, fresh engine acknowledgement, all preflight checks, a clear news window and a disengaged kill switch. Commands expire after 60 seconds. The local runner repeats identity, economics, news and reconciliation checks under its broker lock.
- Pause/Stop stop new entries through the existing durable entry-suspension guard. Pending entry orders are retired by that guard; existing positions remain supervised for TP/risk exits. PAUSING/STOPPING is not broker-flat. A later Start requires flat reconciliation and creates a new run; it never revives a suspended cycle.
- The outbound bridge uses a separate HMAC key, signed request/response bodies, bounded clocks and database replay/rate checks. Secrets are never browser-visible or in this repository. Observer credentials cannot issue commands.
- SQLite FULL/WAL persistence records PROCESSING before dispatch, and a durable active-run marker survives an acknowledgement followed by a crash. Duplicate delivery does not dispatch twice. Uncertain/restarted runs require reconciliation, not blind retry. A stale bridge suspends new entries while the local runner continues supervision.
- Prior incomplete journals are only accepted when verified read-only against broker history (all volumes closed, no unresolved requests, account flat, unchanged state and ledger hash). Evidence is written separately. Old cycles are not counted in a new batch.

Install `bridge.py`, `v51_dashboard_runtime.py` and `install_clone.py` into `D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013`. The installer patches only the clone's bounded runner, preserves backups and fingerprints local engine files. Updating an existing fingerprint requires its exact prior SHA-256. It never starts execution. Do not publish the private original engine or journals.

Runtime command: `python bridge.py --root <isolated-clone>` using the existing GoldTrap virtual environment. Runtime key file: `read_only/demo_bridge.secret`, restricted to the Windows operator and SYSTEM. API key variable: `MASTER_DEMO_BRIDGE_SECRET` on copy-api staging only. Agent startup is standby; only a fresh dashboard Start can create a demo run.

Validation uses synthetic adapters to exercise commands, never as evidence of trading performance. Real broker preflight and reconciliation are read-only. A successful software test is not proof of profitability or authorization to send an order.
