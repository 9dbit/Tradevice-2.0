# Cycle controls and PowerShell journal mirror

Prepared for the existing staging feature branch, 15 October 2026 WIB.

- Wide Start; accessible, circular icon-only Pause and Stop.
- Numeric composer becomes the reported current cycle / requested total after execution.
- Animated completion bar uses completed broker-flat cycles, not a timer or current index.
  An active tenth cycle remains 90%; stale evidence stops animation and is labelled historical.
  A new START request cannot display the previous batch's counter.
- English interface copy; source-authored uploaded skill documents remain unchanged.
- Subtle section dividers, fixed top header and frosted mobile navigation.
- AI pill is Unverified. No authenticated AI connection or model identity is reported,
  so a green Connected label would be unsupported.
- Read-only PowerShell journal window and authenticated, bounded staging ingestion.
  This is a dedicated structured viewer, not a capture of arbitrary PowerShell output.

Verification: 126 web unit tests, 165 API tests, 4 viewer tests and 5 browser tests pass.
Production Next build passes. Browser tests cover 320/360/390/768/1440 px, fixed header,
controls, evidence expiry, progress, terminal rendering and no automatic commands.
UI fixtures are synthetic testing data, not trading-performance evidence.

The viewer was also run in read-only one-shot mode on TRADEVICEPC and returned actual
journal events. No trading command, bridge restart, engine hash/configuration change,
production modification or journal migration was performed. A user-started batch was
active during development. Railway deployment and persistent viewer ingestion remain
post-deploy verification steps; local tests do not establish deployed synchronization.

Deploy copy-api and copy-web together, then follow terminal-mirror/README.md.
