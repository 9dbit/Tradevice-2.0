# Expandable master sections — 2026-10-15

Baseline remote commit: 814a0865ce1d20ad25344583352b65b5a9ffda1b.
Railway copy-web baseline deployment: ba3851e1-0b25-4696-b53b-4a985feec8ab SUCCESS. Auto-deploy follows feature/v51-demo-engine-control-20261014.

## Requested layout
- Every master dashboard and detail-tab section uses a shared ReportSection with an orange circular expand/collapse arrow and a 44px button target.
- Existing detail drawers use the same orange circle, including Preflight, command history, skill details and calendar details.
- News clear / blackout / unavailable content is itself a drawer. Its current status remains visible while the details are collapsed.
- Basket & Adaptive immediately follows News Guard in dashboard document order.
- Sections start expanded; existing detail drawers retain their previous defaults. Expanding/collapsing is local presentation state and survives ordinary polling renders.

## Interaction constraints
Content stays mounted, preserving selections and polling. Collapsed content is inert, aria-hidden and visually hidden; buttons expose aria-expanded and aria-controls. Keyboard activation and reduced-motion behavior are supported.

The batch-stop dialog remains outside the collapsible body, so it still appears if Trading Cycle is collapsed. No trading command, skill mutation, guard change, engine restart or broker action is performed by a collapse toggle.

## Verification
- npm test: 150 passed.
- npm run build: passed.
- Playwright: 4 passed. Browser checks exercise section order, all eight dashboard sections, all detail-tab sections, orange circular controls, News clear collapse, persistence through polling, keyboard activation, mobile/desktop overflow, and batch-stop dialog while collapsed. API traffic is intercepted with synthetic fixtures.
- Source-contract assertion for the System paper journal was updated to require its new ReportSection wrapper while retaining the System-tab boundary.
