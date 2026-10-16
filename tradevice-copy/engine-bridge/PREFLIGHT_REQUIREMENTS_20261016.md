# Actionable preflight requirements — 16 October 2026

Problem: a START could be rejected with only PREFLIGHT_FAILED. Default 0.01-lot
heartbeat checks were also displayed as if they covered the selected 0.10 lot.

Changes:
- Preserve the exact failed checks, settings, observation time and broker margin
  calculation on rejected START receipts in local SQLite and private API storage.
- Publish configuration-scoped idle preflight evidence. The selected composer is
  labelled Not checked when it differs; default checks cannot appear as 10/10 for it.
- Display required/available free margin, shortfall, minimum equity at the observed
  exposure, exposure allowance and basket reserve, plus actionable explanations.
- Historical receipts without evidence remain explicitly unavailable. No backfill.
- Minimum equity = broker used margin + required free margin. Required free margin
  = full standalone exposure allowance + existing basket-loss reserve. Values are
  snapshots, not deposit advice or a guarantee of execution. Minimum display rounds up.

Guard formula, orders, lots, hard loss, journal reconciliation and execution
permissions are unchanged. START always performs the final settings-specific check.
The idle report remains scoped to default settings; it is not a preview for every
composer choice. No separate preview command or automatic retry is introduced.

Deployment: additive DB migration first, copy-api and copy-web staging second,
then guarded demo-clone installer after broker-flat and settled control receipts.
Original V4/V5 trees and production are excluded. Offline fixtures only for tests.

Validation: 170 web unit tests, 29 API tests, 31 bridge tests, 4 runtime/margin
tests (plus 3 subcases), 2 intercepted-browser scenarios and clean production build passed.
Browser tests verified actual lot mismatch, historical numeric requirements, missing
legacy evidence, disabled Start on a failed check and mobile horizontal bounds.
Remote installer --check passed with broker-flat and settled receipts; no orders sent.
