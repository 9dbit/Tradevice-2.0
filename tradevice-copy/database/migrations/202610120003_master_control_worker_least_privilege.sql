-- Tradevice Copy Staging. Narrow the previously granted supervisor role.
-- The Python supervisor only records safety heartbeat, history and expired signals.
-- No paper-order write or operator-audit write is permitted until separately validated.
REVOKE ALL ON TABLE master_control.admin_audit,
  master_control.admin_commands,
  master_control.paper_orders
FROM tradevice_master_worker;

REVOKE SELECT ON TABLE master_control.cycle_history,
  master_control.anomaly_journal,
  master_control.recovery_records
FROM tradevice_master_worker;

REVOKE UPDATE ON TABLE master_control.worker_state,
  master_control.signal_queue
FROM tradevice_master_worker;

GRANT UPDATE (
  holder_id, lease_until, lease_epoch, started_at, heartbeat_at,
  last_cycle_at, mode, reason, cycles, anomalies, clean_ticks,
  last_bad_at, active_source, updated_at
) ON TABLE master_control.worker_state TO tradevice_master_worker;

GRANT UPDATE (status,last_error,updated_at)
ON TABLE master_control.signal_queue TO tradevice_master_worker;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA master_control FROM tradevice_master_worker;
GRANT USAGE ON SEQUENCE master_control.cycle_history_id_seq,
  master_control.anomaly_journal_id_seq,
  master_control.recovery_records_id_seq
TO tradevice_master_worker;

COMMENT ON ROLE tradevice_master_worker IS
  'Staging-only paper supervisor: cannot clear emergency kill_switch, cannot write paper_orders or admin controls';