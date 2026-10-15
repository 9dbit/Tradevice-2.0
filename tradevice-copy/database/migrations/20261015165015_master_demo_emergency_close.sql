-- Explicit emergency reduction command; no public access or trading flags change.
ALTER TABLE master_demo.commands DROP CONSTRAINT commands_action_check,
 DROP CONSTRAINT commands_check,
 ADD CONSTRAINT commands_action_check CHECK(action IN ('START','PAUSE','STOP','EMERGENCY_CLOSE')),
 ADD CONSTRAINT commands_check CHECK(
  (action='START' AND skill_id IS NOT NULL AND target_cycles IS NOT NULL AND skill_hash ~ '^[a-f0-9]{64}$')
  OR (action IN ('PAUSE','STOP') AND target_cycles IS NULL)
  OR (action='EMERGENCY_CLOSE' AND target_cycles IS NULL AND settings IS NULL)
 );
