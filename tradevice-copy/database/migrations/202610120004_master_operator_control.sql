-- Tradevice Copy / staging master operator controls, paper only.
-- Migration is additive: do not erase heartbeat, orders, anomalies or audit records.
-- Never expose the master_control schema via PostgREST or grant browser roles access.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tradevice_master_operator') THEN
  CREATE ROLE tradevice_master_operator NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS master_control.run_state (
 master_id text PRIMARY KEY REFERENCES master_control.worker_state(master_id),
 session_id uuid NOT NULL DEFAULT gen_random_uuid(),
 run_status text NOT NULL DEFAULT 'STOPPED'
   CHECK(run_status IN ('STOPPED','RUNNING','COMPLETED','HALTED')),
 cycle_mode text NOT NULL DEFAULT 'CONTINUOUS'
   CHECK(cycle_mode IN ('CONTINUOUS','CUSTOM')),
 target_cycles integer,
 strategy_cycles bigint NOT NULL DEFAULT 0 CHECK(strategy_cycles>=0),
 news_policy text NOT NULL DEFAULT 'AVOID' CHECK(news_policy IN ('AVOID','ALLOW','ONLY')),
 news_before_minutes integer NOT NULL DEFAULT 15 CHECK(news_before_minutes BETWEEN 0 AND 240),
 news_after_minutes integer NOT NULL DEFAULT 15 CHECK(news_after_minutes BETWEEN 0 AND 240),
 last_command_id uuid,
 last_rejection text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((cycle_mode='CONTINUOUS' AND target_cycles IS NULL)
     OR (cycle_mode='CUSTOM' AND target_cycles BETWEEN 1 AND 1000000))
);
CREATE TABLE IF NOT EXISTS master_control.run_sessions (
 id uuid PRIMARY KEY,
 master_id text NOT NULL REFERENCES master_control.worker_state(master_id),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 initiated_by uuid,
 CHECK (ended_at IS NULL OR ended_at>=started_at)
);
CREATE INDEX IF NOT EXISTS run_sessions_master_started_idx
 ON master_control.run_sessions(master_id,started_at DESC);
CREATE TABLE IF NOT EXISTS master_control.operator_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 master_id text NOT NULL DEFAULT 'tradevice-master-staging'
   REFERENCES master_control.worker_state(master_id)
   CHECK(master_id='tradevice-master-staging'),
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('START','STOP','CONFIGURE','RESET_SESSION')),
 idempotency_key uuid NOT NULL UNIQUE,
 cycle_mode text,
 target_cycles integer,
 news_policy text,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPLIED','REJECTED')),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 CHECK (
  (action='CONFIGURE' AND cycle_mode IN ('CUSTOM','CONTINUOUS')
    AND news_policy IN ('AVOID','ALLOW','ONLY')
    AND ((cycle_mode='CUSTOM' AND target_cycles BETWEEN 1 AND 1000000)
         OR (cycle_mode='CONTINUOUS' AND target_cycles IS NULL)))
  OR
  (action IN ('START','STOP','RESET_SESSION')
   AND cycle_mode IS NULL AND target_cycles IS NULL AND news_policy IS NULL)
 ),
 CHECK ((status='PENDING' AND processed_at IS NULL AND error_code IS NULL)
   OR (status='APPLIED' AND processed_at IS NOT NULL AND error_code IS NULL)
   OR (status='REJECTED' AND processed_at IS NOT NULL AND error_code IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS operator_commands_pending_idx
 ON master_control.operator_commands(master_id,created_at,id) WHERE status='PENDING';
CREATE TABLE IF NOT EXISTS master_control.terminal_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 master_id text NOT NULL REFERENCES master_control.worker_state(master_id),
 session_id uuid,
 source text NOT NULL CHECK(source IN ('CONTROL','WORKER','SAFETY')),
 severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
 event_type text NOT NULL CHECK(length(event_type) BETWEEN 2 AND 80),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 240),
 command_id uuid REFERENCES master_control.operator_commands(id),
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS terminal_events_master_latest_idx
 ON master_control.terminal_events(master_id,id DESC);
ALTER TABLE master_control.paper_orders
 ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES master_control.run_sessions(id);

INSERT INTO master_control.run_state(master_id)
SELECT master_id FROM master_control.worker_state WHERE master_id='tradevice-master-staging'
ON CONFLICT DO NOTHING;
INSERT INTO master_control.run_sessions(id,master_id)
SELECT session_id,master_id FROM master_control.run_state
ON CONFLICT DO NOTHING;

ALTER TABLE master_control.run_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.run_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.operator_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_control.terminal_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA master_control FROM tradevice_master_operator, PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE
 master_control.run_state,master_control.run_sessions,
 master_control.operator_commands,master_control.terminal_events
FROM PUBLIC, anon, authenticated, tradevice_master_operator;
REVOKE ALL ON SEQUENCE master_control.terminal_events_id_seq
FROM PUBLIC, anon, authenticated, tradevice_master_operator;
GRANT USAGE ON SCHEMA master_control TO tradevice_master_operator;
GRANT INSERT(master_id,actor_id,action,idempotency_key,cycle_mode,target_cycles,news_policy)
 ON master_control.operator_commands TO tradevice_master_operator;
GRANT SELECT ON master_control.run_state,master_control.run_sessions,
 master_control.operator_commands,master_control.terminal_events
TO tradevice_master_reader;
GRANT SELECT,INSERT,UPDATE ON master_control.run_state,master_control.run_sessions
TO tradevice_master_worker;
GRANT SELECT ON master_control.operator_commands TO tradevice_master_worker;
GRANT UPDATE(status,error_code,processed_at) ON master_control.operator_commands
TO tradevice_master_worker;
GRANT SELECT,INSERT ON master_control.terminal_events TO tradevice_master_worker;
GRANT USAGE ON SEQUENCE master_control.terminal_events_id_seq TO tradevice_master_worker;

CREATE POLICY run_state_worker ON master_control.run_state
 FOR ALL TO tradevice_master_worker USING (master_id='tradevice-master-staging')
 WITH CHECK(master_id='tradevice-master-staging');
CREATE POLICY run_state_reader ON master_control.run_state
 FOR SELECT TO tradevice_master_reader USING (master_id='tradevice-master-staging');
CREATE POLICY run_sessions_worker ON master_control.run_sessions
 FOR ALL TO tradevice_master_worker USING(master_id='tradevice-master-staging')
 WITH CHECK(master_id='tradevice-master-staging');
CREATE POLICY run_sessions_reader ON master_control.run_sessions
 FOR SELECT TO tradevice_master_reader USING(master_id='tradevice-master-staging');
CREATE POLICY operator_commands_worker ON master_control.operator_commands
 FOR ALL TO tradevice_master_worker USING(master_id='tradevice-master-staging')
 WITH CHECK(master_id='tradevice-master-staging');
CREATE POLICY operator_commands_reader ON master_control.operator_commands
 FOR SELECT TO tradevice_master_reader USING(master_id='tradevice-master-staging');
CREATE POLICY operator_commands_submit ON master_control.operator_commands
 FOR INSERT TO tradevice_master_operator
 WITH CHECK(master_id='tradevice-master-staging' AND status='PENDING' AND processed_at IS NULL);
CREATE POLICY terminal_events_worker ON master_control.terminal_events
 FOR ALL TO tradevice_master_worker USING(master_id='tradevice-master-staging')
 WITH CHECK(master_id='tradevice-master-staging');
CREATE POLICY terminal_events_reader ON master_control.terminal_events
 FOR SELECT TO tradevice_master_reader USING(master_id='tradevice-master-staging');

COMMENT ON TABLE master_control.run_state IS 'Staging paper run controls: strategy cycle count never includes supervisor heartbeat';
COMMENT ON TABLE master_control.operator_commands IS 'Audited, idempotent operator inbox; START always fails closed without approved quote, broker and news gates';
COMMENT ON ROLE tradevice_master_operator IS 'Dedicated INSERT-only command role, no read and no access to money movement';
