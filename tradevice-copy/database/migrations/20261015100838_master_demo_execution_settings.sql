-- Additive: preserve historical commands and journal evidence.
-- The authenticated API validates protocol, lot steps and TP mode for new STARTs.
ALTER TABLE master_demo.commands ADD COLUMN settings jsonb;
ALTER TABLE master_demo.commands ADD CONSTRAINT commands_settings_object
 CHECK (settings IS NULL OR (jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 1024));
COMMENT ON COLUMN master_demo.commands.settings IS 'Immutable authenticated START settings; NULL for legacy commands and PAUSE/STOP';
