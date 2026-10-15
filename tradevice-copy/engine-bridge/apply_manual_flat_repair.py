"""One exact, additive broker-flat reconciliation; never resumes trading."""
import argparse,hashlib,json,sqlite3,sys,time
from pathlib import Path
ROOT=Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
RID='af1f07e0-0061-4cf3-a130-fb4cb8be4b04'
BASELINE='00b438dfc08c2a525a03b1469178e376fdcbd0fadeffff313b6aa97da46d34e2'
MANIFEST='cb71e1f579fe5bdeab65a1b948ff234e61f690fca976e94785864e088d95952e'

def main():
 p=argparse.ArgumentParser();p.add_argument('--stage',type=Path,required=True);args=p.parse_args()
 sys.path.insert(0,str(ROOT));sys.path.insert(0,str(args.stage))
 from bridge import ProcessLock
 from v51_batch_core import ArcRunnerLock,LOCK_KEY,IDENTITY
 from v51_manual_reconciliation import prove_manual_stop
 from goldtrap_arc.persistence import ArcLedger,atomic_json
 from goldtrap_arc.mt5_adapter import MT5ArcAdapter
 from v51_batch_telemetry import report,publish
 import MetaTrader5 as mt5
 with ProcessLock(ROOT/'read_only/demo_bridge.lock'),ArcRunnerLock(lock_key=LOCK_KEY):
  fp=ROOT/'read_only/demo_engine_fingerprint.json';assert hashlib.sha256(fp.read_bytes()).hexdigest()==BASELINE,'BASELINE_CHANGED'
  m=json.loads(fp.read_text());assert all(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()==h for n,h in m['files'].items()),'ENGINE_CHANGED'
  folder=ROOT/'logs/arc_v1'/('v51_dashboard_'+RID.replace('-',''))
  assert hashlib.sha256((folder/'batch_manifest.json').read_bytes()).hexdigest()==MANIFEST,'MANIFEST_CHANGED'
  db=sqlite3.connect(ROOT/'read_only/demo_bridge.sqlite3',isolation_level=None);a=MT5ArcAdapter(mt5,allow_execution=False)
  try:
   a.initialize();proof=prove_manual_stop(ROOT,RID,a,ArcLedger,IDENTITY)
   row=db.execute('SELECT payload,status FROM receipts WHERE id=?',(RID,)).fetchone();cmd=json.loads(row[0])
   assert row[1]=='APPLIED' and cmd['requestId']==RID and cmd['action']=='START','RECEIPT_CHANGED'
   assert db.execute('SELECT request_id FROM active_run WHERE singleton=1').fetchone()[0]==RID,'RUN_CHANGED'
   assert not db.execute("SELECT 1 FROM receipts WHERE status IN ('PROCESSING','UNCERTAIN')").fetchone(),'UNSETTLED_COMMAND'
   backup=args.stage/('before_reconciliation_'+str(time.time_ns()));backup.mkdir(exist_ok=False)
   out=sqlite3.connect(backup/'demo_bridge.sqlite3');db.backup(out);out.close()
   atomic_json(args.stage/'manual_flat_proof.json',proof)
   db.execute('BEGIN IMMEDIATE')
   try:
    db.execute('CREATE TABLE IF NOT EXISTS recovery_audit(request_id TEXT PRIMARY KEY,proof TEXT NOT NULL,at_ms INTEGER NOT NULL)')
    db.execute('INSERT INTO recovery_audit VALUES(?,?,?)',(RID,json.dumps(proof),int(time.time()*1000)))
    assert db.execute('UPDATE active_run SET request_id=NULL WHERE singleton=1 AND request_id=?',(RID,)).rowcount==1
    db.execute('COMMIT')
   except BaseException:db.execute('ROLLBACK');raise
   # Correct display evidence as a separate projection; retain every journal byte.
   manifest=json.loads((folder/'batch_manifest.json').read_text());slot=manifest['slots'][0]
   slot['result'].update(realized_pl_usd=proof['net_usd'],broker_flat_confirmed=True,outcome=proof['outcome'])
   payload=report(folder.name,'STOPPED',[slot],['MANUAL_CLOSE_RECONCILED']);payload['requested']=cmd['targetCycles'];publish(payload)
   print(json.dumps({k:proof[k] for k in ('cycle_id','positions_closed','net_usd','broker_flat','orders_sent','original_journals_modified')}))
  finally:mt5.shutdown();db.close()
if __name__=='__main__':main()
