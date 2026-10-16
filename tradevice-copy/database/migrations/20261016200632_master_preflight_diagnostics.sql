-- Read-only diagnostic history, isolated from the trading command lane.
CREATE SCHEMA IF NOT EXISTS master_diagnostics;
REVOKE ALL ON SCHEMA master_diagnostics FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA master_diagnostics TO tradevice_master_operator;
CREATE TABLE master_diagnostics.inspections (
 request_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 factor text NOT NULL CHECK (factor IN ('identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash','atr','adx','engineReady')),
 prompt text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
 status text NOT NULL CHECK (status IN ('CHECKING','COMPLETED','UNAVAILABLE','FAILED')),
 evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=16000),
 assessment jsonb NOT NULL CHECK (jsonb_typeof(assessment)='object'),
 answer jsonb CHECK (answer IS NULL OR (jsonb_typeof(answer)='object' AND octet_length(answer::text)<=100000)),
 model text CHECK (length(model)<=120),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz
);
CREATE INDEX inspections_actor_factor_history ON master_diagnostics.inspections(actor_id,factor,created_at DESC,request_id DESC);
CREATE INDEX inspections_actor_recent ON master_diagnostics.inspections(actor_id,created_at DESC);
ALTER TABLE master_diagnostics.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_diagnostics.inspections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON master_diagnostics.inspections FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON master_diagnostics.inspections TO tradevice_master_operator;
GRANT UPDATE(status,answer,model,error_code,finished_at) ON master_diagnostics.inspections TO tradevice_master_operator;
CREATE POLICY inspections_actor ON master_diagnostics.inspections FOR ALL TO tradevice_master_operator
 USING (actor_id=nullif(current_setting('tradevice.diagnostic_actor',true),'')::uuid)
 WITH CHECK (actor_id=nullif(current_setting('tradevice.diagnostic_actor',true),'')::uuid);
COMMENT ON TABLE master_diagnostics.inspections IS 'Admin-owned diagnostic questions and immutable engine snapshots. No trading authority; not exposed to Data API roles.';
