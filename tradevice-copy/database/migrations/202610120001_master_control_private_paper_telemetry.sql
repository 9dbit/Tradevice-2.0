-- Tradevice COPY STAGING ONLY. No production access, no live brokerage.
-- Master telemetry is private and NOT part of exposed public/PostgREST schemas.
CREATE SCHEMA IF NOT EXISTS master_control;
REVOKE ALL ON SCHEMA master_control FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tradevice_master_worker') THEN
   CREATE ROLE tradevice_master_worker NOLOGIN NOINHERIT;
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS master_control.worker_state (
 master_id text PRIMARY KEY CHECK (master_id='tradevice-master-staging'),
 holder_id uuid,
 lease_until timestamptz NOT NULL DEFAULT '-infinity',
 lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
 started_at timestamptz,
 heartbeat_at timestamptz,
 last_cycle_at timestamptz,
 mode text NOT NULL DEFAULT 'OFFLINE' CHECK (mode IN ('OFFLINE','DEGRADED','RECOVERING','ACTIVE','HALTED')),
 reason text NOT NULL DEFAULT 'NOT_STARTED',
 active_source text,
 cycles bigint NOT NULL DEFAULT 0 CHECK (cycles >= 0),
 healthy_cycles bigint NOT NULL DEFAULT 0 CHECK (healthy_cycles >= 0),
 anomalies bigint NOT NULL DEFAULT 0 CHECK (anomalies >= 0),
 clean_ticks integer NOT NULL DEFAULT 0 CHECK (clean_ticks >= 0),
 last_bad_at timestamptz,
 kill_switch boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS master_control.cycle_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 master_id text NOT NULL REFERENCES master_control.worker_state(master_id),
 worker_id uuid NOT NULL,
 lease_epoch bigint NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 mode text NOT NULL CHECK (mode IN ('DEGRADED','RECOVERING','ACTIVE','HALTED')),
 reason text NOT NULL,
 active_source text,
 safe_to_admit boolean NOT NULL DEFAULT false,
 execution_mode text NOT NULL DEFAULT 'paper' CHECK (execution_mode='paper')
);
CREATE INDEX IF NOT EXISTS master_cycle_recent_idx ON master_control.cycle_history(master_id,observed_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS master_control.anomaly_journal (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 master_id text NOT NULL REFERENCES master_control.worker_state(master_id),
 worker_id uuid NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
 code text NOT NULL,
 note text NOT NULL
);
CREATE INDEX IF NOT EXISTS master_anomaly_recent_idx ON master_control.anomaly_journal(master_id,id DESC);
CREATE TABLE IF NOT EXISTS master_control.recovery_records (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 master_id text NOT NULL REFERENCES master_control.worker_state(master_id),
 worker_id uuid NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 from_state text NOT NULL,
 to_state text NOT NULL,
 reason text NOT NULL,
 clean_ticks int NOT NULL CHECK(clean_ticks>=0)
);
CREATE INDEX IF NOT EXISTS master_recovery_recent_idx ON master_control.recovery_records(master_id,id DESC);
-- No direct member ingress; signals must come from a future authorized, auditable producer.
CREATE TABLE IF NOT EXISTS master_control.signal_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 master_id text NOT NULL REFERENCES master_control.worker_state(master_id),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RETRY','ACCEPTED_SIMULATED','REJECTED','EXPIRED','DEAD_LETTER')),
 attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0),
 paper_order_id uuid,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(master_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS master_signal_status_idx ON master_control.signal_queue(master_id,status,created_at);
CREATE TABLE IF NOT EXISTS master_control.paper_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 master_id text NOT NULL REFERENCES master_control.worker_state(master_id),
 signal_id uuid NOT NULL UNIQUE REFERENCES master_control.signal_queue(id),
 status text NOT NULL CHECK(status IN ('ACCEPTED_SIMULATED','REJECTED','EXPIRED','UNKNOWN')),
 execution_mode text NOT NULL DEFAULT 'paper' CHECK(execution_mode='paper'),
 -- No fabricated fill prices, equity or performance in this table.
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS master_control.admin_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid NOT NULL,
 action text NOT NULL,
 request_id uuid NOT NULL UNIQUE,
 outcome text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS master_control.admin_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('ENGAGE_KILL','RELEASE_KILL')),
 idempotency_key uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'DISABLED' CHECK(status IN ('DISABLED','PENDING','APPLIED','REJECTED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 applied_at timestamptz
);
-- Defense-in-depth: all tables private and RLS enabled, no rights for browser roles.
ALTER TABLE master_control.worker_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.cycle_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.anomaly_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.recovery_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.signal_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.paper_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.admin_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA master_control FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA master_control FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA master_control TO tradevice_master_worker;
GRANT SELECT,INSERT,UPDATE ON master_control.worker_state TO tradevice_master_worker;
GRANT SELECT,INSERT ON master_control.cycle_history,master_control.anomaly_journal,master_control.recovery_records TO tradevice_master_worker;
GRANT SELECT,UPDATE ON master_control.signal_queue TO tradevice_master_worker;
GRANT SELECT,INSERT,UPDATE ON master_control.paper_orders TO tradevice_master_worker;
GRANT SELECT,INSERT ON master_control.admin_audit TO tradevice_master_worker;
GRANT SELECT ON master_control.admin_commands TO tradevice_master_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA master_control TO tradevice_master_worker;
DO $$
DECLARE target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['worker_state','cycle_history','anomaly_journal','recovery_records','signal_queue','paper_orders','admin_audit','admin_commands']
 LOOP
   IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='master_control' AND tablename=target AND policyname='worker_only') THEN
     EXECUTE format('CREATE POLICY worker_only ON master_control.%I FOR ALL TO tradevice_master_worker USING (true) WITH CHECK (true)',target);
   END IF;
 END LOOP;
END $$;
COMMENT ON SCHEMA master_control IS 'Non-exposed staging master telemetry; paper-only, no member API access';
