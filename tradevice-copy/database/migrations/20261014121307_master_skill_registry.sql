-- Staging only; private catalog, no runtime execution authority.
CREATE SCHEMA master_skills;
REVOKE ALL ON SCHEMA master_skills FROM PUBLIC,anon,authenticated;
CREATE TABLE master_skills.packages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 32),
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 500),
 strategy text NOT NULL CHECK(length(strategy) BETWEEN 1 AND 80),
 kind text NOT NULL CHECK(kind IN ('BUILTIN','MANIFEST','DOCUMENT')),
 sha256 text NOT NULL UNIQUE CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 filename text NOT NULL,
 archive bytea NOT NULL CHECK(octet_length(archive) BETWEEN 1 AND 524288),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 uploaded_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(name,version)
);
CREATE TABLE master_skills.selection (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton=true),
 selected_skill_id uuid REFERENCES master_skills.packages(id),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO master_skills.selection(singleton) VALUES(true);
CREATE TABLE master_skills.audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('UPLOAD','SELECT')),
 skill_id uuid REFERENCES master_skills.packages(id),
 previous_skill_id uuid REFERENCES master_skills.packages(id),
 revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skill_audit_recent ON master_skills.audit(created_at);
ALTER TABLE master_skills.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_skills.selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_skills.audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA master_skills FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA master_skills TO tradevice_master_operator;
GRANT SELECT,INSERT ON master_skills.packages,master_skills.audit TO tradevice_master_operator;
GRANT SELECT ON master_skills.selection TO tradevice_master_operator;
GRANT UPDATE(selected_skill_id,revision,updated_by,updated_at) ON master_skills.selection TO tradevice_master_operator;
CREATE POLICY skill_packages_read ON master_skills.packages FOR SELECT TO tradevice_master_operator USING(true);
CREATE POLICY skill_packages_upload ON master_skills.packages FOR INSERT TO tradevice_master_operator WITH CHECK(kind IN ('MANIFEST','DOCUMENT') AND uploaded_by IS NOT NULL);
CREATE POLICY skill_selection_read ON master_skills.selection FOR SELECT TO tradevice_master_operator USING(true);
CREATE POLICY skill_selection_update ON master_skills.selection FOR UPDATE TO tradevice_master_operator USING(singleton) WITH CHECK(singleton);
CREATE POLICY skill_audit_read ON master_skills.audit FOR SELECT TO tradevice_master_operator USING(true);
CREATE POLICY skill_audit_insert ON master_skills.audit FOR INSERT TO tradevice_master_operator WITH CHECK(actor_id IS NOT NULL);
COMMENT ON TABLE master_skills.selection IS 'One staging configuration selection. Not permission to trade; not an engine activation acknowledgement.';
INSERT INTO master_skills.packages(name,version,description,strategy,kind,sha256,filename,archive,manifest) VALUES ('GoldTrap ARC Research Guard','5.1','Research candidate: fixed L1–L5 and guarded adaptive L6–L10. Performance is not validated for live trading.','GOLDTRAP_ARC_V51','BUILTIN','bcdefbaf270419f2dbe5968bd10e5a88dc3fe4efc7086fef5b2869fb40f81cee','goldtrap-v51.json',decode('7b22736368656d61223a20227472616465766963652e74726164696e672e736b696c6c2e7631222c20226e616d65223a2022476f6c645472617020415243205265736561726368204775617264222c202276657273696f6e223a2022352e31222c20226465736372697074696f6e223a202252657365617263682063616e6469646174653a206669786564204c31e280934c3520616e642067756172646564206164617074697665204c36e280934c31302e20506572666f726d616e6365206973206e6f742076616c69646174656420666f72206c6976652074726164696e672e222c20227374726174656779223a2022474f4c44545241505f4152435f563531222c2022646f63756d656e746174696f6e223a202250524541524d5f424f54483a2042555920616e642053454c4c204c31e280934c352062726f6b65722070656e64696e67206f72646572732e20496e697469616c20747261702037303020706f696e74733b206669786564204c31e280934c352073706163696e6720312c30303020706f696e74732c206e6f207265616e63686f722e204c36e280934c31302072657175697265206174206c6561737420312c373030206164766572736520706f696e74732066726f6d2061637475616c2070726576696f75732066696c6c20616e6420612074776f2d7374616765207374727563747572616c20726576657273616c206f6e20636c6f736564204d312063616e646c65732c2077697468696e203320636f6d706c657465642063616e646c65732061667465722061726d2e2041545231343b20626f64792f415452203e3d20302e35303b20626f64792f72616e6765203e3d20302e35352e2042617365206c6f7420302e30313b206d756c7469706c696572203c3d20312e36382e204261736b657420746172676574202b24332e35303b2068617264206c6f7373202d243132303b207374726573732072657365727665202431352e2044757261626c6520617574686f72697a6174696f6e2065787069726573206166746572203630207365636f6e64732e204e6f20626c696e6420726573656e643b20434f4d504c455445206f6e6c792061667465722062726f6b65722d666c6174207265636f6e63696c696174696f6e2e20466f72657820466163746f727920686967682d696d70616374206e6577733a2073757370656e64206e657720656e7472696573203630206d696e75746573206265666f726520616e642061667465723b206b656570207375706572766973696e67206578697374696e67206578706f737572652e205468657365206172652074686520646f63756d656e7465642063616e6469646174652072756c65732c206e6f7420636f6e6669726d6174696f6e206f662063757272656e746c79206c6f6164656420706172616d65746572732e2055706c6f616420616e642073656c656374696f6e206e65766572206578656375746520636f6465206f7220617574686f72697a65206f72646572732e227d','hex'),'{"schema": "tradevice.trading.skill.v1", "name": "GoldTrap ARC Research Guard", "version": "5.1", "description": "Research candidate: fixed L1–L5 and guarded adaptive L6–L10. Performance is not validated for live trading.", "strategy": "GOLDTRAP_ARC_V51", "documentation": "PREARM_BOTH: BUY and SELL L1–L5 broker pending orders. Initial trap 700 points; fixed L1–L5 spacing 1,000 points, no reanchor. L6–L10 require at least 1,700 adverse points from actual previous fill and a two-stage structural reversal on closed M1 candles, within 3 completed candles after arm. ATR14; body/ATR >= 0.50; body/range >= 0.55. Base lot 0.01; multiplier <= 1.68. Basket target +$3.50; hard loss -$120; stress reserve $15. Durable authorization expires after 60 seconds. No blind resend; COMPLETE only after broker-flat reconciliation. Forex Factory high-impact news: suspend new entries 60 minutes before and after; keep supervising existing exposure. These are the documented candidate rules, not confirmation of currently loaded parameters. Upload and selection never execute code or authorize orders."}'::jsonb);
