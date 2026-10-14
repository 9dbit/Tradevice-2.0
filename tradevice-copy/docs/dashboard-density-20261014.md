# Compact dashboard UI release

Scope: copy-web staging. Builds on the shared six-hour calendar patch in commit
9bcda91362f24e4db2776322d164e000acb87188; no broker process or configuration is changed by this UI patch.

- Telemetry: three columns on phone and desktop, icons, explicit units, large values.
- Equity and completed/executed cycle summary: two columns; paper journal remains in System.
- Preflight: checkmark for fresh true evidence, dash otherwise, aggregate count visible when collapsed.
- Engine heading: Ready requires fresh `canStart`; fresh blocked evidence displays Blocked. Running,
  Starting, Pausing, Paused and Stopping retain their actual state. Expired evidence displays Stale.
- Market values expire after eight seconds without fresh evidence; missing data stays unavailable.
  Batch results remain historical and explicitly identified when stale.
- Supporting market, adaptive, calendar, command, skill and terminal details use inline animated drawers.
  Hidden contents are inert, keyboard controls expose expanded state, reduced motion is supported.
- Current blockers remain visible outside drawers. Command gating and receipt handling are unchanged.
- Orange headings and values, borderless sections, tighter spacing; desktop uses two section columns.

Validation: 120 web tests passed; four isolated browser tests passed; production Next build passed.
Browser checks cover widths 320/360/390/768/1440, drawer keyboard and reduced-motion behavior,
heartbeat loss, current-value expiry, blocked preflight and existing bounded command behavior.
Fixtures are synthetic UI data with API interception, not trading-performance evidence. No staging
or broker orders were sent. Two static UI-copy expectations were updated to match the requested
new headings and layout; engine and strategy assertions were not changed.

Rollout: deploy the staged copy-api and copy-web source revisions together. The shared-calendar
collector/bridge patch still requires separate installation into the isolated V5.1 clone after
fresh broker-flat, no-active-run and no-unresolved-command checks. Railway deployment alone
cannot update the Windows collector. Follow engine-bridge/calendar/README.md. Do not restart
or replay a stopped batch as part of deployment.
