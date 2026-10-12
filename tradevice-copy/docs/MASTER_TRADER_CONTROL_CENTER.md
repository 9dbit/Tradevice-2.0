# Master Trader Control Center, staging

## URLs

- /master/preview : public **synthetic preview**, no credentials and no real master data.
- /master : **server-verified Supabase master admin**, actual staging infrastructure status only.

The preview includes an equity graph, cycle state machine, anomaly simulation, risk panel, synthetic paper journal, status cards, filters and mobile navigation. Every illustrative number, order and event is labelled synthetic. The preview has **no mutation API**.

The admin-only GET /api/master/overview performs live GoTrue /auth/v1/user verification on every fetch. It permits only nonanonymous, email-confirmed, nondeleted users with server-owned app_metadata.tradevice_master_admin === true. User-editable user_metadata and general authenticated roles never grant admin. The server pins the Supabase staging project reference and paper-only environment. It never includes an admin/service-role key or user tokens in any returned payload and sets no-store headers.

## Admin access setup

1. In the **dedicated staging Supabase project** scqzlcivherovlwqypeu, first invite a controlled admin user through Supabase Auth. Confirm the email. No pilot users existed at the last audit.
2. Through the privileged Supabase Auth Admin API or Dashboard user management (not user_metadata and never raw SQL), set that user's app_metadata.tradevice_master_admin to boolean true. Never expose service_role credentials or use member registration to assign it.
3. Sign in to /master with that staging identity. Access is checked by the server, not by front-end flags.
4. Normal members and unapproved users should get 403 and must not be able to read operational data. Unauthenticated requests receive 401.

## Current live evidence boundaries

Railway Tradevice Copy Staging has ONLY two services: copy-web and copy-api. The Python ContinuityEngine under services/continuity_engine.py is an OFFLINE prototype, not an independently deployed long-running worker. Thus /api/master/overview honestly reports masterWorker NOT_DEPLOYED, journal NOT_CONNECTED, cycle count null, equity null, fills empty, anomaly history empty and control availability false. It independently checks the paper-only /health endpoint of the API. Do not claim production master data or a continuous managed worker yet.

The kill switch displayed is disabled because there is no authenticated durable command channel. Never treat local preview scenarios as live operations. Live execution, deposits and withdrawals remain disabled.

## Development boundaries

New files are under web/app/master/, web/app/api/master/ and web/lib/master-security.*. Frozen member app/page.tsx and app/globals.css are unchanged. Deployment is permitted in Railway **staging** only.

## Next runtime integrations

After an approved master supervisor is deployed as a managed, single-leader staging worker, stream read-only telemetry from Postgres (via a carefully scoped server-side service identity), implement auth-checked control commands with idempotency and audit trails, verify freshness of cycles and quote source, then wire the enablement of an emergency stop. Never silently label a missing service as ACTIVE or replace actual metrics with sample numbers.
