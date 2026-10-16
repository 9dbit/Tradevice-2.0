# Verified shortfall must not be reported as unavailable evidence

Read-only audit on 16 October 2026, approximately 15:00 WIB, isolated V5.1 demo clone.

## Evidence

- Broker positions/orders: 0/0; balance, equity and free margin: USD 764.40.
- Selected/default settings: base lot 0.01, FIXED_3_5, hard basket loss -250.
- Existing conservative maximum lot sequence: 0.01, 0.02, 0.03, 0.05, 0.08,
  0.13, 0.22, 0.37, 0.62, 1.04.
- Admission reserves one complete side plus the opposing fixed L1-L5 ladder,
  using standalone broker margin calculations without hedge credit.
- At the audited quote, margin envelope was USD 577.87; basket-loss and extra
  reserve were USD 265.00. Required USD 842.87 exceeded free margin by USD 78.47.
  These values vary with broker calculations and price; they are not UI constants.
- `margin_envelope()` raised `ArcSafetyError('RESEARCH_MARGIN_ENVELOPE_INSUFFICIENT')`.
  Runtime swallowed that specific result into `MARGIN_ENVELOPE_UNVERIFIED`.

## Change

- Classify only the exact known safety exception as `MARGIN_ENVELOPE_INSUFFICIENT`.
  Unknown errors, invalid economics and missing broker evidence remain unverified.
- Preserve `margin=false`, `PREFLIGHT_MARGIN`, server-side Start admission and all
  reserve/lot/execution settings. No trading command or strategy change.
- Dashboard explains insufficient capacity separately from unavailable data.
  Stale data never produces a fresh explanation. Explicit margin blockers override
  cached positive check marks, including active-batch preflight deferral.

## Installation and validation

- Source SHA before: `74c977aa6829da407297065f04538b5a2b8e7c8f43d6a7c0797aa84630256fb7`.
- Source SHA after: `c7593d3fc9ad3ac66989b93a49b54af381f02edc19af8b029e49e1493615a674`.
- Guarded installer checks all fingerprint entries, reconciled local controls,
  demo identity, repeated empty broker book, stopped tasks and runner lock.
- Installed fingerprint: `83d4b84db95f4c4ce99af9c042b964ef7f5eff7b39e91afadc4990dbe88c2e77`.
- 154 journal/state files preserved by hash; 0 orders sent; no cycle started.
- Bridge and read-only observer tasks restored to running.
- Signed runtime reached the backend at 15:06:24 WIB with `margin=false`,
  `MARGIN_ENVELOPE_INSUFFICIENT`, and identity/brokerFlat/quote/spread/commission/
  news/reconciled/engineHash all true. READY runtime state alone is not canStart.
- Three mocked runtime regression tests passed. Web: 167 unit tests, a clean
  production build and one targeted browser regression passed. The first browser
  attempt found old prerendered output in the existing build directory; rebuilding
  from a clean generated directory resolved that artifact mismatch.

This repairs diagnostics. It does not make the current settings admissible or
prove trading profitability. Lowering reserves merely to remove the blocker is
outside this change.
