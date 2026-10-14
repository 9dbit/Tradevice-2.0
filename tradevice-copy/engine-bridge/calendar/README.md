# Shared six-hour calendar schedule

One collector on TRADEVICEPC retrieves the official Forex Factory weekly export at most once every six hours (four attempts per rolling day). Railway does not independently fetch the provider. No subscription or provider switch is needed for this patch.

The engine evaluates every high-impact event, all currencies, continuously from the same calendar snapshot exported in authenticated bridge heartbeats. Blackout boundaries remain inclusive, 60 minutes before/after, with overlapping windows merged. Calendar CLEAR never bypasses identity, price, spread, margin, reconciliation, or explicit bounded START gates.

Schedule evidence has a hard maximum age of 6 hours 10 minutes. The ten-minute overlap accommodates the existing maximum five-minute upstream response Age plus one bounded request. This is an explicit research policy change from five minutes, not proof that the publisher cannot revise a schedule. Quote/engine heartbeat limits are unchanged. A failed fetch or invalid response revokes trust immediately; expiry never extends because the dashboard polls or the process restarts. An actual outage/blackout still durably suspends entries and retires pending entries while TP/hard-loss supervision continues. No suspended basket is automatically rearmed.

Local restart reuse requires an HMAC-authenticated cache using the restricted existing bridge key with a separate cryptographic domain. The original source timestamp and provenance survive reuse. Historical unsigned snapshots are never trusted. Durable cooldown is shared by callers; Retry-After can only lengthen the six-hour interval. An orphan lock still needs inspection.

Bridge protocol is negotiated: old API receives the old payload until a signed response advertises SCHEDULE_6H_V1. The new API validates bounded calendar evidence only after HMAC/replay/lease checks; it reevaluates the schedule itself and expires calendar availability after 15 seconds without the bridge. Browser validation preserves source/bridge timestamps through repeated projections. Public health contains summary only.

## Installation sequence

1. Publish the staged copy-api and copy-web commit; confirm SUCCESS. Old bridge remains compatible but the new API will report UNKNOWN until evidence arrives.
2. Confirm no pending/unconfirmed dashboard command, no active local run, and broker positions/orders both empty. Do not stop a bridge supervising an active basket.
3. Stop only TRADEVICE-V51-DemoBridge; verify its process has exited. Back up bridge.py, v51_dashboard_runtime.py, v51_runtime_calendar.py, v51_forexfactory_calendar.py, v51_news_guard.py and the current fingerprint in a new directory inside read_only.
4. Install the reviewed files from engine-bridge and calendar into the isolated clone only. Run existing install_clone.py with the explicitly inspected previous fingerprint SHA to archive/update the manifest. Never modify V4/V5 originals, skill selection, safety variables or cycle journals.
5. Start the bridge in standby using its existing pythonw task. First startup may wait for the existing five-minute cooldown because old snapshots are unsigned. Subsequent restarts reuse only valid authenticated evidence.
6. Verify same calendar timestamp/hash, next refresh approximately six hours away, fresh authenticated bridge, unchanged broker-flat, and no new commands. Do not start a cycle as part of deployment.

## Evidence from 14 October 2026

The last dashboard command requested two cycles. Batch v51_dashboard_d75e1eebebda4a9799d1d67f9ea5e667:

- BUY 8f2cc9c9: three fills, net +3.50 USD, broker-flat at 23:09:50 WIB.
- SELL 176a6d4b: L1 0.01 and L2 0.02 filled. At 23:10:14 WIB broker fingerprints still contained SELL L3/L4/L5. At 23:10:18 WIB NEWS_ENTRY_SUSPENDED reason CALENDAR_REFRESH_PENDING preceded three accepted CANCELs and reconciliation. At 23:12:01 WIB both positions completed at broker TP, net +3.51 USD, flat lifecycle reconciled.
- Total +7.01 USD. This is observed demo history, not a forecast or performance validation. The observed pending disappearance was a calendar-refresh admission failure, not failure to initially place the ladder.
- Read-only broker audit at approximately 23:19 WIB found zero positions, zero pending, demo server identity verified, and local active_run NULL. No order call was made by the investigation.

Validation: API, web, protocol and synthetic-engine tests. The synthetic engine tests explicitly preserve pending recovery beyond five minutes and during six-hour refresh overlap, but retire it on actual expiry/blackout; existing hard-loss and TP supervision tests remain enforced. No original assertion was weakened to conceal the reported incident.
