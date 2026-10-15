Read-only direction enrichment installed on the isolated V5.1 PC clone. Snapshot import changed from v51_batch_telemetry.read_batch to v51_batch_direction.read_batch; neither module is an engine fingerprint target. Original snapshot backed up under read_only/observer_direction_before_20261015.py. Only observer task restarted.

Direction is read from the exact batch/cycle state with matching cycle ID, allowlisted BUY/SELL, otherwise null. Batch timestamps are preserved. Does not authorize orders or modify journals.

15 October audit: batch v51_dashboard_8778cc636c8142d8b02deb1a099117e0, cycle 957ee500, BUY, five layers, one completed broker-flat risk exit, -122.89 USD. Risk commitment P&L -122.884. Recovery latch remains set; UI Reset does not reconcile it. Exact exception leading to bridge recovery is still unconfirmed.

UI verification: 135 web tests, production build, recovery browser regression passed. API BUY/unknown-side projection checks passed. Full API pytest suite not run in this environment.
