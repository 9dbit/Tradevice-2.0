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

## Verified staging rollout

Application commit `47c844a44c0a3b05065ead81834d2e50c9bee6d1` automatically deployed from GitHub. copy-api deployment `5fcf6a37-8773-482c-bc2e-f0668cc30d45` and copy-web `61dea357-48de-4f8d-a4ad-568646029640` reached SUCCESS. Public `/master` returned HTTP 200 and its account-close JavaScript matched the tested local build (SHA-256 `95686f78efff308679cfed89aec89067bd8f776e92b2b732ddd4e98ae987116e`). API health remained paper, live=false, copy=false.

The additional connector deploy request was cancelled by approval; it was not retried. Existing GitHub auto-deploy had already started independently. The unapplied source staging patch was restored to branch-following configuration without a commit pin; no additional deployment is needed for that redundant patch.

Windows initially rejected atomic replacement of the runtime source although its existing write handle and ACL allowed modifications. Both failed attempts were rolled back and the old fingerprint verified. The installer now retries replacement and can use the permitted existing write handle under the stopped-task/global-lock preconditions, with backup, fsync, byte verification and automatic rollback. It changes no ACL or file attributes.

Installation succeeded with fingerprint `b629ab7c2a5aad9bdae51fcdf7f621a51ba0cd6f97eeaf37dc9f73b31440052d`; 144 original journal files were unchanged. Both tasks resumed, the API received the new emergency protocol with engineHash=true, and the observer reported 69 accepted snapshots / zero failures at the verification sample. Recovery remained required, as intended; no trading controls were invoked during rollout.
