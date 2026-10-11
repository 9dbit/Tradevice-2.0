# Tradevice Copy Foundation - Verified Project State

> Durable recovery checkpoint. Update this file at EVERY subsequent milestone, using fresh GitHub, Railway, Supabase and test evidence. Never infer a deployment result from a commit alone.
>
> Checkpoint date: 2026-10-12 (Asia/Jakarta). Scope: **staging only**. No production mutation authorized.

## Repository and exact checkpoint

- Repository: `9dbit/Tradevice-2.0`
- Working branch: `feature/tradevice-copy-foundation-20261011`
- **Verified branch HEAD before this checkpoint:** `a02c48afdb3f448bd12e46bea019bf981d2eef38`
- [Previous code commit](https://github.com/9dbit/Tradevice-2.0/commit/a02c48afdb3f448bd12e46bea019bf981d2eef38): web styling-test assertions.
- **This checkpoint is a new documentation-only commit**. Its own SHA cannot be embedded inside itself without another commit. Resolve the current HEAD from GitHub on resume. Do not assume that a documentation commit has been deployed.
- Production branch was **not modified by this checkpoint**. Verify production status independently before making broader claims.

## Railway staging (live platform inspection)

- Railway project: `Tradevice Copy Staging`, `94d0fbf7-dcd3-440e-aba8-20eb15c76857`
- Environment: `staging`, `3504b1ca-a65f-4f3f-84e9-9ae8f4e23bcb`
- **Web / copy-web**: service `e33e2c92-075f-4edc-a416-75e950564d5a`; current successful deployment `d669e3cd-24b8-40a5-aa66-5f1e3ba8ec42`; source commit `a02c48afdb3f448bd12e46bea019bf981d2eef38`; 1/1 replicas running; public domain `https://copy-web-staging.up.railway.app`
- **API / copy-api**: service `d1a971ee-acba-4052-a3e7-b24cd88ab732`; current successful deployment `807486d2-6faa-440e-9e30-08918c2f7a81`; source commit `795fb29bb1a8d1210f4fccb36499fbaf7e4c5f2c`; 1/1 replicas running; public domain `https://copy-api-staging-4c33.up.railway.app`
- Railway environment status: both services **online**; zero active warning/critical notifications; no pending changes at checkpoint.
- Historical issue: one **FAILED** web deployment `4d45f162-8bbf-42b3-b618-e7b6bddb78da` in last 24h, subsequently replaced by the successful deployment above. Root cause not independently re-verified here; inspect logs if regression recurs.
- Platform **SUCCESS** and replica health are **not proof** of browser E2E, two-user authorization, API response payload correctness or absence of downstream failures.

## Supabase staging (live project inspection)

- Dedicated project: `tradevice-copy-staging`, ref `scqzlcivherovlwqypeu`; distinct from existing unrelated Supabase project.
- Previously verified migrations: `20261010202228_tradevice_copy_foundation_paper_only` and `20261010202352_tradevice_copy_rls_performance_tuning`.
- Eleven `public.copy_*` tables are present, all with RLS **enabled**: `copy_profiles`, `copy_brokers`, `copy_accounts`, `copy_strategies`, `copy_subscriptions`, `copy_risk_profiles`, `copy_signals`, `copy_orders`, `copy_funding_events`, `copy_referrals`, `copy_audit_events`.
- Current table counts: 1 broker, 1 strategy, **0 profiles / accounts / orders / referrals**. Thus actual cross-member isolation has **not** been proven by real user fixtures.
- Previous Supabase **security advisor** returned no findings; performance advisor noted five unused indexes (possibly normal for empty/low-traffic staging). Advisor cleanliness is not a substitute for adversarial RLS testing.

## Tests: evidence versus gaps

- Repository includes Python tests `tradevice-copy/api/tests/test_foundation.py`, `test_pilot_gate.py` and `tradevice-copy/services/test_paper_broker.py`.
- Repository includes Node tests and Playwright specs under `tradevice-copy/web/tests/` and `tradevice-copy/web/e2e/`, including `pilot-login.spec.ts`, `staging-public.spec.ts`, `mobile.spec.ts` and `responsive-overflow.spec.ts`.
- Earlier local work reported **46 API tests and 34 paper-broker tests passing**. Those counts are historical, NOT a test execution in this checkpoint. Rerun from the current branch to refresh evidence.
- Playwright real two-member pilot test is configured to **skip** without `COPY_PILOT_A_EMAIL/PASSWORD` and `COPY_PILOT_B_EMAIL/PASSWORD`. **No successful two-member real-login test has been verified**.
- Browser screenshots / iPhone Safari tests for the latest deployed visual revision still require explicit execution and recorded result.
- Never equate passing mock-based tests with two real authenticated users and database RLS verification.

## Safety and scope

- **Paper-only** throughout this workstream. Never enable live trading, live broker SDK/credentials, automated copy execution, deposits, withdrawals, or commission settlement.
- Member reads must validate Supabase identity and enforce account-level RLS. No service-role secrets in public client or browser runtime.
- Paper Broker is a local journal/simulator. Do **not** wire it to public order execution until transactional, owner-checked, risk-limited, replay-safe server implementation passes security tests.
- Do not change Tradevice 2.0 production branch, Railway production services or unrelated Supabase project.

## Next work: Priority Phase 1 - staging QA

1. Verify external `/api/health`, `/api/runtime`, `/api/status`, API `/health` and `/readyz` response status, shape and paper-mode safety.
2. Run fresh Python, Node and Playwright tests from the current branch; record commands, pass/fail/skip counts and SHA.
3. Run browser E2E on actual Railway staging, especially Safari/mobile navigation, demo synthetic-data labels, disabled funding, and unauthorized member requests.
4. Investigate any failed Railway deployment or runtime exception and fix **staging only**. Recheck deploy status and public health.

## Next work: Priority Phase 2 - real pilot authentication & isolation

1. Configure **two invited, email-confirmed test users only** in dedicated staging project. Store credentials securely in test/CI secrets, never this markdown file.
2. Create minimal, clearly marked paper test fixtures for each user (accounts, risk, order, referral); never contaminate live data.
3. Assert login/logout, session expiry, unauthorized response, direct account-ID enumeration, cross-account orders/risk/referrals and PostgREST RLS isolation from user A vs B.
4. Verify restrictions also hold for anon tokens and unapproved users; capture test logs without bearer tokens or PII.
5. Roll back/remove disposable fixtures if feasible; preserve audit evidence and IDs only when non-sensitive.

## Milestone discipline (required)

At each completed milestone, **update this same file** with:
- inspection time (UTC and/or WIB), feature branch and starting/ending commit SHAs;
- exact changed paths and linked commit/PR;
- Railway service/deployment IDs, status and whether **SUCCESS** was actually observed;
- SQL migration IDs, RLS verification result and row-count context;
- exact commands/tests, pass/fail/skip numbers and tested SHA;
- unresolved blockers, risks, owner and the next concrete action.

After GitHub commit, read this file back from the branch to confirm persistence. Never report a skipped or unexecuted test as PASS.

## Milestone: Phase 1, Railway HTTP-log verification (2026-10-12 WIB)

- **Starting checkpoint commit:** `34734711c5d7c827b996961d95b36fed6cd08f78` (documentation only). This follow-up updates this file; its resulting commit SHA must be read from GitHub.
- Inspected **actual Railway deployment logs** for web deployment `d669e3cd-24b8-40a5-aa66-5f1e3ba8ec42` and API deployment `807486d2-6faa-440e-9e30-08918c2f7a81`. These are historical recorded requests, not requests generated by this checkpoint.
- **Web HTTP proxy log, confirmed:** `GET /` 200, `GET /demo` 200, `GET /brand/tradevice-arrow.svg` 200, `GET /api/runtime` 200, `GET /api/status` 200; unsigned `GET /api/member/me` 401. Static JS and CSS returned 200. No proxy upstream error reported on these sampled requests.
- **API proxy and runtime logs, confirmed:** `GET /health` 200, `GET /readyz` 200, anonymous `GET /api/v1/me` 401. Uvicorn startup complete; server listened on `0.0.0.0:8080`.
- **Method limitation:** direct network requests to both Railway public domains from this execution environment failed due to DNS resolution. A web fetch also failed to access those URLs. Do **not** record these checks as newly executed, independent HTTP probes or Playwright browser runs. Railway logs establish that the listed requests succeeded on the specified deployments at their logged times.
- **Fail/skip counts:** New automated test suites run in this checkpoint: **0**; pass/fail/skip counts **not available**. Existing code has Node, Python, and browser specs, but full repeat execution is pending.
- **Outstanding:** (1) independent external HTTP test from network-capable runner; (2) current Playwright browser suite and mobile Safari/viewport captures; (3) two invited, confirmed pilot accounts and two distinct fixture sets; (4) account-scoped REST and RLS cross-user negative tests. Funding, copy and live execution must remain disabled.
- **No application files or service variables changed during this milestone**; no redeploy performed; production untouched.

### Resume actions

1. Verify current branch HEAD and `PROJECT_STATE.md` content first.
2. Use GitHub Actions or an authorized network-capable CI runner to run `npm test`, `npm run build`, Playwright staging public/mobile tests, and Python `pytest`; record exact run links and counts. Do not commit a PASS status without the logs.
3. For Phase 2, check whether two **invited test accounts** already exist; if not, plan a secure pilot-invite workflow. Never write passwords or access tokens to GitHub markdown or logs. Require real two-user authenticated E2E before accepting isolation gate.

## Milestone: 2026-10-12 WIB - fix Phase 1 CI visual regression

- Initial verified checkpoint commit: `af96b3ed3a7e5bb33f315044e7b01ee5a897e204`.
- Real CI evidence: GitHub Actions run [38165729513](https://github.com/9dbit/Tradevice-2.0/actions/runs/38165729513) on that SHA **FAILED** only in browser E2E: **31 passed, 1 failed, 1 skipped**. Python regression step **40 passed**; Node unit tests, Next.js production build and typecheck steps **SUCCESS**. Do not classify the entire run as PASS.
- Cause: `tradevice-copy/web/e2e/responsive-overflow.spec.ts` asserted obsolete **orange linear-gradient** login CTA, conflicting with deployed **solid white button** design. The current theme was intentional; application UI code was not changed.
- Fix commit: `c0b1af3b2e5905de6be8b75e50b0a87873cb7994`; only the visual Playwright spec changed to expect solid white (`rgb(247,247,247)`) background, no gradient, dark (`rgb(17,17,17)`) text, and pill radius.
- New GitHub Actions run: [38166064024](https://github.com/9dbit/Tradevice-2.0/actions/runs/38166064024), **in_progress** on last poll. Its result MUST be verified before declaring Phase 1 CI green. New documentation commit may start an additional run; record its result separately.
- Separate staging Supabase SQL read: `auth.users=0`, `public.copy_profiles=0`, `public.copy_accounts=0`; Phase 2 two-real-member authentication and isolation remains **blocked by absent pilot accounts**. No users were created, no secrets generated, no tables changed.
- Railway environment read: web deployment `014b1fc2-e278-46bb-83ac-dcad1b40e72d` is **SUCCESS**, API deployment `807486d2-6faa-440e-9e30-08918c2f7a81` is **SUCCESS**; both services 1/1 running. A failed **historical** web release is still present in the 24h failures count.
- Next: poll CI 38166064024 to terminal state; inspect browser failure if any. Once green, configure two invited staging-only verified pilot users securely and run the existing `pilot-login.spec.ts` and API RLS cross-tenant negative tests. Do not insert real credentials in repository. No production or live trading changes authorized.
