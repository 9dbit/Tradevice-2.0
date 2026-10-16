# Start followed by safety stop with remaining broker exposure

## Audited evidence

The deployed web commit was `d9b5704` (Railway SUCCESS). The installed isolated
engine fingerprint was `b723859fa6ccc649e52cd507b99956663edb569ac58e29a03dd77194bd2ed50f`.

- Batch `v51_dashboard_698d7bc054554894b59a82f701c26873` started at
  2026-10-16 13:25:52 WIB. START receipt was APPLIED.
- Cycle `1cac343f` armed its initial ladder and SELL L1 filled.
- At 13:26:00 WIB, `refresh_atr_tp()` called `validate_closed_m1()` with
  `allow_boundary_wait=True`. The valid but one-bar-behind M1 history raised
  `ArcM1BoundaryWait`. The ATR-refresh handler omitted this RuntimeError subtype.
- The exception reached the batch's terminal handler, which invoked safety
  cleanup and recorded SAFETY_STOP. The BUY pending orders were cancelled.
  Cancellation of SELL L2 was definitively rejected with 10029 (too close to
  market), with a proven-no-effect resolution. Cleanup stopped as BLOCKED.
- Read-only MT5 inspection at 13:29 WIB found one SELL position and three pending
  orders. At 13:37 WIB there were two SELL positions and zero pending orders.
  The remaining positions had individual broker TPs and no broker SL. The stopped
  engine was not enforcing the software basket loss threshold.
- The UI also displayed an old COMPLETE Close all receipt from 03:09 WIB after
  the newer START. That historical receipt did not prove the current book flat.

## Fix and limits

Catch `ArcM1BoundaryWait` specifically in the existing ATR-unavailable path.
Retain the last verified target without changing its candle timestamp. Defer
ATR-dependent new entries and pending-TP updates until a valid sample arrives.
Continue position supervision, the existing pending ladder, hard-loss checking,
and last verified target exits. No general exception suppression, fabricated
freshness, widened candle tolerance, automatic resume, or broker retry is added.

The UI hides a completed prior Close all report after a newer non-rejected START.
Current flat claims require the same fresh evidence as the Reset/Start controls.
The safety-stop popup explicitly warns that positions/pending orders may remain
and automatic basket supervision is unverified.

23 offline engine tests passed, including four new cases for minute-boundary
delay before arming, after L1, hard-loss exit, and verified-target exit. The source
under test exactly matched the inspected installed execution/config/candle files
before applying the patch. Installer patch hash and changed-source rejection
were checked without installation.

Web validation: 165 unit tests, production build and three targeted browser tests
passed, covering old-close/new-START isolation, honest flat-state confirmation,
and verified Close all returning to local Reset with Start still gated.

## Installation boundary

The engine patch was initially held while this batch retained exposure.
`apply_m1_boundary_fix.py --check` requires reconciliation, no unsettled control
receipts, exact source hashes, the expected fingerprint, demo identity and two
empty broker-book observations. `--install` additionally requires stopped bridge
and observer tasks and the runner lock. It backs up source and fingerprint,
preserves journal hashes, and never sends broker commands or starts a cycle.

Execution source before: `22e67057fabacef43aaece36ba318868acd4c3594955bc0f9bfccea5ad23bf47`.
Execution source after: `899df4b098d6c41357b9d18ef1204f5012ca5624263e900d64cbbb58d8bb29ad`.
After broker-flat reconciliation, install into the V5.1 research clone only.
The stopped batch must not resume; a new batch requires an explicit Start.

## Installed outcome

An independently submitted account Close all request
`024846d8-f5e9-4af5-89ca-8c171d29807c` became APPLIED/COMPLETE with zero positions
and zero pending orders. The bridge reconciled and cleared active_run. Read-only
installation checks then passed. No close/start request was sent by this audit.

The first installation hit Windows replacement sharing restrictions and restored
the original source/fingerprint. The installer was updated to use the existing
file's permitted write handle after bounded replacement retries, with tasks
stopped, runner lock held, verified backup and unchanged ACLs.

Installation succeeded; both tasks restarted. All 149 original journal/state
files retained their hashes. Installed fingerprint:
`bf1446ab1045710eb1a04ed3f6dc468b10b3a383491cf4e4d0a4b92b07b782ee`.
The same 23 mocked-broker tests also passed on Windows against the installed
source (overlapping the 23 local tests, not 23 additional independent cases).
At 13:45 WIB the book was 0/0, active_run NULL, unsettled receipts 0, with no new
START. At 13:46 WIB the backend heartbeat reported READY, all preflight checks
true, revision 1 and no blockers. These observations expire normally and do not
establish profitability or guarantee future execution.

The web fix deployed as `3bc5c5d` with Railway SUCCESS; public /master referenced
the tested JS asset with SHA-256
`39c70032ca0dc1dea7003081de7c1e426eda6a66d6225c86e63a64648adbdae1`.
