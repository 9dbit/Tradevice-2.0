-- STAGING master telemetry reader only; no public/anon/authenticated access.
-- Credentials are provisioned separately through secret-safe operations, not migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradevice_master_reader') THEN
    CREATE ROLE tradevice_master_reader NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA master_control TO tradevice_master_reader;
GRANT SELECT ON master_control.worker_state,
  master_control.cycle_history,
  master_control.anomaly_journal,
  master_control.recovery_records,
  master_control.signal_queue,
  master_control.paper_orders
TO tradevice_master_reader;

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'worker_state','cycle_history','anomaly_journal',
    'recovery_records','signal_queue','paper_orders'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'master_control' AND tablename = target
        AND policyname = 'master_reader_select_only'
    ) THEN
      EXECUTE format(
        'CREATE POLICY master_reader_select_only ON master_control.%I FOR SELECT TO tradevice_master_reader USING (true)',
        target
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON ROLE tradevice_master_reader IS 'Read-only Master Trader monitoring identity for dedicated staging telemetry API';
