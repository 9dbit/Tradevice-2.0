# Tradevice Copy Phase 2: Member Security

**Scope:** dedicated Supabase staging project scqzlcivherovlwqypeu and Railway staging only.
**UI/UX:** locked at a886508d. **Live broker and funding:** strictly disabled.

## Verified guardrails

- FastAPI member validation uses Supabase Auth /auth/v1/user, requires a confirmed nonanonymous user and an approved copy_profiles row.
- Supabase security advisor: zero security lints.
- All 11 copy_* tables have RLS. The anon role has no SELECT on them; authenticated has no INSERT, UPDATE or DELETE on any; internal audit and signals cannot be directly selected.
- FastAPI now verifies row ownership even after upstream PostgREST returns data. Mismatched account, order, risk, or referral rows fail closed.
- tests/test_member_security.py covers mock two-member isolation, missing/invalid bearer, unconfirmed/anonymous/unapproved membership, malicious upstream rows, outages, and disabled funding.
- scripts/real_member_acceptance.py checks two genuine JWT sessions, cross-owner API denial and direct PostgREST RLS, session refresh/logout and paper-only 409 routes. It NEVER creates identities or trades.

## Outstanding external prerequisite

The latest dedicated staging database check returned ZERO Auth users, copy_profiles and copy_accounts. The connected Supabase management tool cannot invite or confirm Auth users. Do not insert directly into auth.users, fabricate confirmation, or mark real acceptance as complete.

1. Invite two distinct controlled pilot addresses using [staging Supabase Authentication > Users](https://supabase.com/dashboard/project/scqzlcivherovlwqypeu/auth/users).
2. Have both recipients accept and confirm their email. Verify both records have distinct Auth IDs, nonnull email_confirmed_at, and is_anonymous=false.
3. Through staging SQL Editor as an administrator (never the public client), provision exactly one copy_profiles and one paper-only copy_accounts row for each confirmed Auth UUID. Use the seeded disabled broker catalog entry named "Paper simulator (not a broker)" and a distinct external_account_id such as "pilot-paper-" plus UUID. Optionally create disabled copy_risk_profiles rows. Never create trades, funding, live brokers, or production data.
4. Put these five values only in protected GitHub Actions secrets: COPY_STAGING_PUBLISHABLE_KEY, COPY_PILOT_A_EMAIL, COPY_PILOT_A_PASSWORD, COPY_PILOT_B_EMAIL, COPY_PILOT_B_PASSWORD. Publishable key ONLY, never service_role. Never reveal the values in chat or source.
5. In the [Copy Staging Validation workflow](https://github.com/9dbit/Tradevice-2.0/actions/workflows/copy-staging-validation.yml) dispatch branch feature/tradevice-copy-foundation-20261011 with real_pilot_security=true. The runner fails closed if a user lacks an owned paper account.
6. Verify full CI passes with REAL_PILOT_PHASE_2_PASS, JWT-bound PostgREST cross-account denial, API 404 cross-owner denial, token refresh/logout and disabled paper/live funding. Store the CI run ID without saving any secrets.

**Session caveat:** Logging out invalidates refresh-token access, but access JWTs can remain usable until their expiry. For immediate revocation, server-side session validation is needed; do not claim access tokens are always revoked instantly.

**Acceptance status:** NOT COMPLETE until genuine two-member tests pass. Mock tests and rollback-only RLS simulations are supporting evidence, not substitutes. API hardening also requires a successful staging API deployment; the web deployment is separate.
