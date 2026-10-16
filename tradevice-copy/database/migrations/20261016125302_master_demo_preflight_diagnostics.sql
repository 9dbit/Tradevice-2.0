-- Additive evidence only: do not rewrite old receipts or alter admission guards.
ALTER TABLE master_demo.commands ADD COLUMN diagnostics jsonb;
ALTER TABLE master_demo.commands ADD CONSTRAINT commands_diagnostics_object
 CHECK (diagnostics IS NULL OR (jsonb_typeof(diagnostics) = 'object' AND octet_length(diagnostics::text) <= 8192));
COMMENT ON COLUMN master_demo.commands.diagnostics IS 'Engine preflight evidence bound to rejected START settings and observation time; NULL for legacy or unavailable evidence';
