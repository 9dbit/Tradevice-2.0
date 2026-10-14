-- Private staging demo lane. Existing paper worker and historical journals are unchanged.
CREATE SCHEMA master_demo;
REVOKE ALL ON SCHEMA master_demo FROM PUBLIC,anon,authenticated;
CREATE TABLE master_demo.runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 observed_ms bigint NOT NULL DEFAULT 0,
 received_at timestamptz,
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(snapshot)='object')
);
INSERT INTO master_demo.runtime(singleton) VALUES(true);
CREATE TABLE master_demo.commands (
 request_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('START','PAUSE','STOP')),
 skill_id uuid REFERENCES master_skills.packages(id),
 skill_hash text,
 selection_revision bigint NOT NULL,
 target_cycles integer CHECK(target_cycles BETWEEN 1 AND 10),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DISPATCHED','APPLIED','REJECTED','EXPIRED','UNCERTAIN')),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '60 seconds',
 processed_at timestamptz,
 CHECK((action='START' AND skill_id IS NOT NULL AND target_cycles IS NOT NULL AND skill_hash ~ '^[a-f0-9]{64}$') OR (action IN ('PAUSE','STOP') AND target_cycles IS NULL))
);
CREATE INDEX demo_commands_recent ON master_demo.commands(created_at DESC);
CREATE INDEX demo_commands_pending ON master_demo.commands(created_at) WHERE status IN ('PENDING','DISPATCHED');
ALTER TABLE master_demo.runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_demo.commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA master_demo FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA master_demo TO tradevice_master_operator;
GRANT SELECT,UPDATE ON master_demo.runtime TO tradevice_master_operator;
GRANT SELECT,INSERT,UPDATE ON master_demo.commands TO tradevice_master_operator;
CREATE POLICY demo_runtime_read ON master_demo.runtime FOR SELECT TO tradevice_master_operator USING(true);
CREATE POLICY demo_runtime_update ON master_demo.runtime FOR UPDATE TO tradevice_master_operator USING(singleton) WITH CHECK(singleton);
CREATE POLICY demo_commands_read ON master_demo.commands FOR SELECT TO tradevice_master_operator USING(true);
CREATE POLICY demo_commands_insert ON master_demo.commands FOR INSERT TO tradevice_master_operator WITH CHECK(status='PENDING');
CREATE POLICY demo_commands_update ON master_demo.commands FOR UPDATE TO tradevice_master_operator USING(true) WITH CHECK(true);
-- Read only the emergency switch; no permission to change it.
GRANT SELECT(master_id,kill_switch) ON master_control.worker_state TO tradevice_master_operator;
CREATE POLICY demo_operator_safety_read ON master_control.worker_state FOR SELECT TO tradevice_master_operator USING(master_id='tradevice-master-staging');
