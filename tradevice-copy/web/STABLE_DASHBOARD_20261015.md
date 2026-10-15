# Stable dashboard updates — 2026-10-15

Baseline: remote 0b65ef0d41a4e09eede65b0edd62cbe746f7e953, copy-web deployment fec57d13-67bd-428d-a59f-dbcfc16043e4 SUCCESS.

## Changes
- Basket & Adaptive now immediately precedes Growth, below Trading Cycle. This supersedes its prior position below News Guard.
- Drawer circles use the same 7px right inset as the circle centered inside each 44px section button. Mobile sections and nested drawers share one right column.
- Active-batch information remains mounted outside the collapsible body. A heartbeat gap changes its wording to last reported / execution unverified instead of removing it. A fresh non-active runtime clears the old activity message.
- Overview polls every 1,000ms, retaining the existing single in-flight request guard. Requests time out after 12 seconds and obsolete effect responses are ignored after JSON decoding.
- Basket display retains the last accepted number and original sample/tick timestamps when a new sample is temporarily absent. It is explicitly labeled Last known, with age and cycle identity; it never represents readiness or authorization.
- A fresh report for a different cycle, a completed cycle, or invalid diagnostics clears the cached estimate. New accepted samples replace it directly without an intermediate blank.

## Limits
The one-second interval requests the latest available backend snapshot. It does not increase the engine/bridge sampling rate or fabricate one-second market ticks. Stale data remains stale; existing validators, freshness limits and all trading controls are unchanged. Browser background scheduling can throttle polling.

## Verification
- Unit suite: 153 tests passed, including new estimate expiry, replacement, cycle-boundary and invalid-data cases.
- Production build passed.
- Playwright: 5 passed. Mobile circle centers align within 1px at widths 320/390/430. Frame sampling found zero blank estimate frames and zero missing activity-message frames across sample expiry and temporary service failure. Verified one-second polling, fresh replacement, cycle transitions, collapse behavior and existing blocker handling.
- Browser regression tests use synthetic intercepted API responses only; no broker or command actions are sent by the new stability test.
