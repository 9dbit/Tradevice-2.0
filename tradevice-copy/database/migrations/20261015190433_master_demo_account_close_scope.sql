-- Bind account-wide emergency scope without changing authorization or old commands.
ALTER TABLE master_demo.commands DROP CONSTRAINT commands_check,
 ADD CONSTRAINT commands_check CHECK(
  (action='START' AND skill_id IS NOT NULL AND target_cycles IS NOT NULL AND skill_hash ~ '^[a-f0-9]{64}$')
  OR (action IN ('PAUSE','STOP') AND target_cycles IS NULL)
  OR (action='EMERGENCY_CLOSE' AND target_cycles IS NULL AND
      (settings IS NULL OR settings = '{"close_scope":"ALL_DEMO_ACCOUNT"}'::jsonb))
 );
COMMENT ON COLUMN master_demo.commands.settings IS 'Immutable START settings or explicitly confirmed emergency close_scope; NULL for legacy requests and PAUSE/STOP';

