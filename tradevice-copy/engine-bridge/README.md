# Staging demo engine control

The dashboard has a separate authenticated demo lane. The Railway paper supervisor, member copy execution, and live flags are unchanged. Only the isolated TRADEVICEPC clone can access MT5. No uploaded Python or ZIP is executed.

- Skill SELECT uses the existing singleton/revision lock and accepts only the reviewed built-in package fingerprint. The engine loads its local adapter and reports the same skill ID, revision and package hash. A selection receipt is not an activation acknowledgement.
- Start requires an authenticated master admin, an explicit Start click for the displayed demo cycle count, 1–10 cycles, fresh engine acknowledgement, all preflight checks, a clear news window and a disengaged kill switch. Commands expire after 60 seconds. The local runner repeats identity, economics, news and reconciliation checks under its broker lock.
- Pause/Stop stop new entries through the existing durable entry-suspension guard. Pending entry orders are retired by that guard; existing positions remain supervised for TP/risk exits. PAUSING/STOPPING is not broker-flat. A later Start requires flat reconciliation and creates a new run; it never revives a suspended cycle.
- The outbound bridge uses a separate HMAC key, signed request/response bodies, bounded clocks and database replay/rate checks. Secrets are never browser-visible or in this repository. Observer credentials cannot issue commands.
- SQLite FULL/WAL persistence records PROCESSING before dispatch, and a durable active-run marker survives an acknowledgement followed by a crash. Duplicate delivery does not dispatch twice. Uncertain/restarted runs require reconciliation, not blind retry. A stale bridge suspends new entries while the local runner continues supervision.
- Prior incomplete journals are only accepted when verified read-only against broker history (all volumes closed, no unresolved requests, account flat, unchanged state and ledger hash). Evidence is written separately. Old cycles are not counted in a new batch.

Install `bridge.py`, `v51_dashboard_runtime.py` and `install_clone.py` into `D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013`. The installer patches only the clone's bounded runner, preserves backups and fingerprints local engine files. Updating an existing fingerprint requires its exact prior SHA-256. It never starts execution. Do not publish the private original engine or journals.

Runtime command: `python bridge.py --root <isolated-clone>` using the existing GoldTrap virtual environment. Runtime key file: `read_only/demo_bridge.secret`, restricted to the Windows operator and SYSTEM. API key variable: `MASTER_DEMO_BRIDGE_SECRET` on copy-api staging only. Agent startup is standby; only a fresh dashboard Start can create a demo run.

Validation uses synthetic adapters to exercise commands, never as evidence of trading performance. Real broker preflight and reconciliation are read-only. A successful software test is not proof of profitability or authorization to send an order.

Heartbeat repair (2026-10-14): the bridge reuses a pinned TLS connection and counts network/preflight time in its polling cadence (minimum 500 ms wait). Failed exchanges close the connection without immediate resend. The eight-second freshness guard is unchanged. The staging API pipelines independent heartbeat statements within the existing transaction and reads dashboard state in one consistent query. The browser serializes status polls, discards older snapshots and expires retained evidence at its original timestamp. A network failure never renews evidence; 401/403 clears it immediately.

TRADEVICEPC task `TRADEVICE-V51-DemoBridge` uses the virtual environment's `pythonw.exe` to avoid a closable console window. Startup remains standby and does not resume a prior run. The previous task XML and bridge source are backed up in the clone's `read_only` directory. No original engine or journal is changed.

2026-10-15 closed-M1/settings revision: see `EXECUTION_SETTINGS_20261015.md` and the baseline-bound patch package. New dashboard Starts require explicit settings protocol; use `apply_execution_settings.py` only after the documented idle/flat checks. Original source and legacy journals retain their baseline configuration digest.

ATR TP correction: `ATR_PRICE_DISTANCE_20261015.md` replaces numeric-USD ATR targets with a frozen price distance from the basket weighted entry. Requires settings protocol `V51_ATR_PRICE_DISTANCE_20261015`.

Latest execution policy: [Current ATR basket profit USD](DYNAMIC_ATR_USD_20261015.md). Supersedes the frozen ATR distance policy.

Automatic mode (2026-10-17): an explicit **Enable Automatic** request may arm
while market preflight is blocked. The supported, fresh bridge and approved
skill binding are still mandatory. The PC waits for all checks, executes one
reviewed cycle, proves flat reconciliation, and checks again. There is no total
cycle-count limit. Selected lot/TP settings are bound to the arming request.
Pause, Stop, emergency close, kill, stale control connection, selection change,
risk stop, uncertainty, or process restart disarms it. An open basket retains
existing local supervision. Startup never re-arms it.

The private command settings JSON stores `cycleMode: AUTOMATIC` and a one-cycle
child target; wire exchange separates mode from execution settings. No schema
migration is required. Old bridges cannot arm Automatic. Install the two reviewed
adapter files with `install_automatic.py --check`, then `--install` only while
idle/flat with the bridge and observer tasks stopped. The installer validates
exact prior hashes, preserves journals/backups, and never starts a cycle.
