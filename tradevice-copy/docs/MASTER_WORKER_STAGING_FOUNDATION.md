## 2026-10-12: private staging master runtime foundation

- Applied Supabase staging-only migration `master_control_private_paper_telemetry` on `scqzlcivherovlwqypeu`; eight private `master_control` tables, all RLS-enabled; anonymous/authenticated roles have no schema/table grants. Security advisors returned zero lints.
- Added isolated `tradevice-copy/worker` Python supervisor, Dockerfile and safety regression. Requires dedicated Postgres LOGIN role `tradevice_master_worker` with narrowly provisioned credentials. A NOLOGIN grant role alone cannot authenticate. Provision credentials out of GitHub and set `MASTER_DATABASE_URL` ONLY on the future dedicated worker.
- Lease claim uses `SELECT ... FOR UPDATE` with database time, durable epoch and lease; transactional heartbeat/cycle/anomaly/recovery history. The approved quote source is explicitly `none` and orders cannot be accepted; missing feed results in DEGRADED not ACTIVE. On database failure, no order activity occurs.
- **Not deployed and not operational** until dedicated restricted login credentials and a worker service are configured and verified. Frontend admin remains read-only with NOT_CONNECTED response. Production and frozen member UI untouched.
- Pending: worker credentials, worker Railway service, private authenticated telemetry service, admin status UI integration, CI/build verification, real pilot Auth acceptance, command channel and multi-worker integration tests.

## Separate telemetry reader (2026-10-12)

The staging-only migration `master_control_telemetry_reader_rls` adds the NOLOGIN `tradevice_master_reader` role, SELECT grants and SELECT-only RLS policies on six private telemetry tables. The reader has no DML privileges and cannot access admin audit/commands. Both worker and reader remain NOLOGIN until secret-safe dedicated credentials are provisioned. This migration has been applied in staging, verified by pg_roles, and Supabase security advisors reported zero findings. Admin UI still reports unavailable operational telemetry, not synthetic production data. Do not grant the browser direct database access.
