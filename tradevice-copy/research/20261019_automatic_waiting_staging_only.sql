-- Staging only. Apply separately after review; never on production.
-- Pure operator preparation intent. No trigger, worker feed, broker job or
-- relationship to master_demo.commands.
CREATE TABLE IF NOT EXISTS master_demo.automatic_waiting (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton IS TRUE),
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('OFF','WAITING_VALIDATION')),
  target_cycles integer NOT NULL DEFAULT 100 CHECK (target_cycles=100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Match the established private master_demo pattern. The API uses
-- tradevice_master_operator, not a generic master_worker account.
ALTER TABLE master_demo.automatic_waiting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_demo.automatic_waiting FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON master_demo.automatic_waiting TO tradevice_master_operator;

CREATE POLICY waiting_operator_read
ON master_demo.automatic_waiting FOR SELECT TO tradevice_master_operator
USING (singleton IS TRUE);

CREATE POLICY waiting_operator_insert
ON master_demo.automatic_waiting FOR INSERT TO tradevice_master_operator
WITH CHECK (singleton IS TRUE AND target_cycles = 100 AND
            status IN ('OFF','WAITING_VALIDATION'));

CREATE POLICY waiting_operator_update
ON master_demo.automatic_waiting FOR UPDATE TO tradevice_master_operator
USING (singleton IS TRUE)
WITH CHECK (singleton IS TRUE AND target_cycles = 100 AND
            status IN ('OFF','WAITING_VALIDATION'));
-- No DELETE or broker execution privileges are granted here.
COMMENT ON TABLE master_demo.automatic_waiting IS
 'Operator preparation only. No order execution, authorization or unlock.';
