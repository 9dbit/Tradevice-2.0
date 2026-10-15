# Recovery controls and truthful basket telemetry

## Audited incident

Batch `v51_dashboard_713456b271f94c3aa77656bd0e7d81df` stopped during its third cycle (`e12c4d92`), after two completed cycles. A pending cancellation received broker retcode 10029 (frozen), then the order filled during cleanup reconciliation. The original unresolved cancellation and SAFETY_PAUSED state are preserved. A connected bridge does not mean that the stopped runner supervises the remaining positions.

## Changes

- Basket displays read-only observer open P&L plus swap when no fresh engine estimate exists. Realized P&L is excluded and labeled. Historical engine thresholds retain their original timestamp, for at most seven days, with enforcement explicitly unverified. They grant no execution authority.
- Close all remains available in recovery and as an idle standby control, requires a fresh compatible bridge, and explicitly covers ALL positions and pending orders on the connected DEMO account, including manual positions and other symbols. It never starts a new cycle.
- Account-wide scope is immutable command evidence (`closeScope: ALL_DEMO_ACCOUNT` / persisted `close_scope`). Protocol `V51_EMERGENCY_CLOSE_20261016` is required. Legacy commands retain their original owned-position scope.
- Pause/Stop in recovery can retire TRADEVICE pending orders without closing positions. Recovery remains locked until reconciliation is proved.
- Account reduction verifies pinned demo identity, hedging mode, the global broker lock, source fingerprint, exact ticket/volume, quotes, durable intent, terminal history, and repeated empty books. Ambiguous responses are never blindly resent, including connection loss after dispatch. Partial fills remain uncertain.
- Exact frozen-cancel incidents can acquire independent reconciliation proof after account-flat reduction. Original engine journals and state are never rewritten. Any missing proof keeps recovery required.

## Validation

- Web: 160 unit tests and production build passed.
- Browser: four focused scenarios passed, covering recovery controls, account-wide slider scope, durable request identity and stable running display.
- API: 61 targeted tests passed.
- Engine/controller: 60 synthetic tests passed, including frozen cancel/fill races, ambiguous receipts, partial fills, connection gaps, identity failures and expiration.
- Migration `20261015190433_master_demo_account_close_scope` applied to staging; existing action checks retained.
- No real Start, Pause, Stop or Close all command was issued for testing. Build/test success does not establish trading performance or reliability under every broker condition.

## Deployment

Deploy compatible copy-api before installing the new bridge protocol, then copy-web. The isolated clone installer validates the prior fingerprint and package manifest, requires stopped bridge/observer tasks, a terminal batch and no processing receipt, obtains the broker lock, backs up replaced files, and verifies original journal hashes remain unchanged. Restart only the bridge and read-only observer. The observer success interval becomes one second plus request duration; failure backoff remains in place.

Original V4/V5, production, master-worker, live/copy execution flags and old journals are unchanged. Existing open exposure requires an explicit user slider action; installation itself performs no broker writes.
