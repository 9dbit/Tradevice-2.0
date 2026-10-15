# Bridge latency and Close all slider — 16 October 2026 WIB

## Audited baseline

Remote branch and both successful Railway deployments were at ad9cf204a4956202b202b879e4b1d06fdddf03fa before edits. Runtime evidence showed an active batch. The PC engine and bridge were left running and unchanged; no trading commands were issued.

Railway HTTP samples around 17:50–17:58 UTC on 15 October showed successful exchanges taking roughly 2.18–2.53 seconds and demo reads around 1.87–2.10 seconds. Dashboard proxy reads took around 2.1–2.3 seconds, occasionally 3.35 seconds. A runtime snapshot was 5.21 seconds old despite successful ongoing exchanges. Each read/exchange previously opened a fresh PostgreSQL connection and performed another role lookup. These cumulative delays could consume the unchanged eight-second evidence lifetime.

## Changes

- Reuse a bounded psycopg pool only in the staging demo lane: two minimum/four maximum connections, eight waiting clients and three-second acquisition timeout. Validate the allowed DSN and the operator role on every new physical connection. Preserve transaction rollback/commit, command request-ID reconciliation, and lock ordering. Never automatically replay a failed transaction.
- Preserve all original evidence timestamps and the eight-second freshness limit. No artificial heartbeat renewal or widened authorization window.
- Replace the standalone Emergency Close panel with a Close all confirmation slider in the Start Cycle position during an active/unfinished batch. Use the same active-state and freshness predicates as Pause/Stop; protocol support and an in-flight close also gate the slider.
- A completed rightward drag and release confirms the existing emergency command. Track taps, partial drags, canceled gestures and disabling during a gesture do not send. Keyboard users move to 100 and confirm with Enter/Space. Transport uncertainty retries the same request ID.
- Keep batch notice copy stable through freshness transitions and reserve space for a persistent bridge status. Display genuine connection loss; do not hide it behind a success state.
- Close success still requires the existing APPLIED receipt and COMPLETE broker reconciliation evidence. Scope remains TRADEVICE-owned XAUUSDm positions and pending orders. No automatic batch restart.

## Validation

160 web unit tests, production build, 39 targeted API tests, and four browser scenarios passed. Browser scenarios cover mobile safe-area layout, stable telemetry/notice/arrow alignment, slider positioning and stale gating, partial/tap rejection, complete confirmation, durable receipt after reload, keyboard confirmation and same-ID retry. All command tests use synthetic intercepted requests. Real iPhone rendering and actual broker close execution were not exercised.

Deployment services: copy-api and copy-web. No master-worker, database schema, PC bridge, engine, broker configuration or strategy change.
