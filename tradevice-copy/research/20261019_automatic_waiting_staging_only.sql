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
-- Owner is expected to be the staging database migration role. In the
-- inspected database, master_demo.runtime/commands are owned by postgres.
-- No assumed master_worker role exists in this project. Deployment must first
-- verify MASTER_OPERATOR_DATABASE_URL has SELECT/INSERT/UPDATE rights to
-- this new table; grant to that exact vetted login separately if necessary.
COMMENT ON TABLE master_demo.automatic_waiting IS
 'Operator preparation only. No order execution, authorization or unlock.';
