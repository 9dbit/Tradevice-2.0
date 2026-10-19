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
REVOKE ALL ON master_demo.automatic_waiting FROM PUBLIC, anon, authenticated;
-- The staging master-worker/operator role already owns the master_demo
-- namespace; verify its grants before migration execution.
COMMENT ON TABLE master_demo.automatic_waiting IS
 'Operator preparation only. No order execution, authorization or unlock.';
