# Active-batch preflight presentation — 2026-10-15

## Evidence and root cause
- Baseline remote commit: 656e222ff095ad3e768fa2e4ed812181091651cf; local tree matched 932bd7c195995a86ca7c0e3d1a5818f65cb78317.
- Railway copy-web staging: SUCCESS deployment 687128ad-3ffa-418e-903d-1702a7c091e8; branch source is unpinned, auto-deploy enabled.
- Read-only inspection of TRADEVICEPC clone confirmed Runtime.checks expires its cached new-START checks after 5 seconds. Controller.snapshot avoids calling preflight while the run thread owns MT5. This avoids a competing adapter initializing/shutting down the connection during supervision.
- API start_blockers intentionally evaluates eligibility for a NEW Start, including ENGINE_NOT_READY for RUNNING and PREFLIGHT_* for expired checks. It does not schedule subsequent cycles.
- Frontend incorrectly rendered every false/expired check as an indefinitely spinning pending check and listed new-START blockers as if they stopped the existing batch.
- Read-only demo_batch.json evidence: batch v51_dashboard_483efdc67c3f44048fcebe0e3fac8646 RUNNING; cycle f55717cd COMPLETE_TARGET_HISTORY, +3.50 USD, broker-flat true; cycle a20d630d ACTIVE, first one then two layers. This proves the first-to-second transition occurred; it does not guarantee later cycles.
- Reviewed v51_batch_core.run and Session.admission: each next slot requires admission, telemetry acknowledgment, calendar/deadline checks, broker-flat/economics checks; completed cycles reconcile unresolved requests and history first. No engine function or MT5 call was executed for this audit.

## Changes
- Fresh STARTING/RUNNING/PAUSING/STOPPING shows new-start preflight as Deferred, with a clear explanation of batch ownership and per-cycle engine admission.
- Stale/Unavailable/Blocked/Verified have distinct static status labels and icons. No indefinite spinners or fresh green checkmarks from active-batch cached checks.
- Suppress only the exact derived ENGINE_NOT_READY/PREFLIGHT_<known-check> messages during active-batch deferral. Preserve real news, engine fingerprint, recovery, safety, command and unknown blockers. Real news/fingerprint failures also mark their rows Blocked.
- Recovery overrides deferral; PAUSED and STOPPED still require current preflight. UI remains display-only: no authorization, command handling, checks, backend, engine, fingerprints, orders or journals changed.
- Update browser assertions that still expected nine checks and the retired pre-news UI; verify the current ten-check and explicit news-unavailable contract.

## Validation
- npm test: 150 passed.
- npm run build: passed.
- Targeted browser tests cover active expired preflight, real blocker visibility, Ready transition, stale evidence, recovery, layout and Pause/Stop availability using synthetic intercepted APIs only.
- Deployment target: copy-web staging only; GitHub branch push triggers Railway build. Live deployment and public asset verification are reported separately after observing SUCCESS.
