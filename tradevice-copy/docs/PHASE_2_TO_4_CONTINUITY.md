# Tradevice Copy paper-only: Phase 2 to Phase 4 implementation

UI/UX is locked at commit a886508d. No Next.js UI code or CSS was modified.

## Phase 2: real member admission

Dedicated Supabase staging scqzlcivherovlwqypeu has zero confirmed auth users,
accounts, and orders. Consequently, real two-member login and cross-user JWT RLS
tests are NOT accepted as complete. Existing simulated SQL assertions and mock
browser tests do not replace real Auth. The project has 11 RLS-protected copy
tables and a read-only FastAPI member API. Do not create credentials in SQL,
GitHub, or chat.

Acceptance gate: provision two separately confirmed staging Auth invitations,
create one paper account for each with owner IDs, and run real client/browser
login, refresh, sign-out and direct PostgREST plus API cross-user-denial tests.
No production identity or signing key may be reused.

## Phase 3: durable paper continuity (implemented offline, not deployed worker)

The standalone Python continuity_engine.py contains:
- One pinned master identity, append-only audit observations and SQLite inbox.
- Monotonic quote sequence, age, spread and gap detection.
- A persistent heartbeat that advances during data anomalies.
- DEGRADED/RECOVERING/ACTIVE/HALTED modes. Requires three consecutive good
  quotes plus cooldown to resume. Manual kill remains latched.
- Optional standby DATA feed for the SAME master only. No automatic master
  strategy/account substitution.
- Strict XAUUSD paper lot size, 100 oz/lot simulated contract convention,
  per-signal risk cap 0.25 percent of supplied paper equity, and at most
  three unreconciled accepted orders per account.
- Persistent idempotency, TTL expiration, bounded retries and dead letters.
- Calls only the local PaperBroker to journal ACCEPTED_SIMULATED.
  DOES NOT represent a fill and NEVER sends a broker instruction.

The module is an OFFLINE single-worker prototype; the production-grade
transactional Postgres inbox/outbox, trusted signed signal ingress, service
identity, durable worker deployment, broker reconciliation and alert routing
still require a separately verified staging integration. Never expose this
module through an unauthenticated API.

## Phase 4: deterministic performance validation (implemented offline)

validation.py accepts explicit labelled SYNTHETIC exit prices and fees and
reports win rate, profit factor, net PnL, realized equity drawdown, consecutive
losses and active/degraded cycle ratio. With no actual quote/fill evidence,
slippage and future win probability are deliberately NOT_MEASURED/NOT_ESTIMATED.
This is a formula and scenario validation, NOT a one-week performance result.

Run from repo root:
PYTHONPATH=tradevice-copy/services python -m pytest tradevice-copy/services -q
PYTHONPATH=tradevice-copy/services python tradevice-copy/services/validation.py path/to/synthetic.json

## Strategy / master continuity hardening next

For master trader anomalous events, the event loop and audit must continue,
but order admission MUST pause. Resume only on bounded clean market and
execution data, a cooldown, and verified idempotency. Do not forward old
signals after their TTL. Do not auto-replace a losing or missing master with an
unapproved different trader. Any real broker execution requires a separate,
explicit authorization and safety review.

Remaining gates: two real invited pilot identities; signed signals;
Postgres transactional journaling; trusted market feeds, paper fill provenance,
cross-replica leases, execution reconciliation; worker deployment and monitored
multi-day paper forward test. Production and live trading remain disabled.
