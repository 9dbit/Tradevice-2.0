"""One reviewed recovery of the specified terminal risk stop. No order dispatch."""
import hashlib,json,pathlib,shutil,sqlite3,sys,time
ROOT=pathlib.Path(r'D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013')
STAGE=ROOT/'read_only/recovery_fix_20261015'
RID='8778cc63-6c81-42d8-b02d-eb1a099117e0'
OLD='18511874c8efbe9a703369228d038b8f74f46e1d8c58c7899024457eca69c8d3'

def main():
 sys.path.insert(0,str(ROOT));sys.path.insert(0,str(STAGE))
 from bridge import ProcessLock
 from v51_batch_core import IDENTITY,ArcRunnerLock,LOCK_KEY
 from v51_terminal_reconciliation import prove_risk_stop
 from goldtrap_arc.mt5_adapter import MT5ArcAdapter
 from goldtrap_arc.persistence import ArcLedger,atomic_json
 import MetaTrader5 as mt5
 fingerprint=ROOT/'read_only/demo_engine_fingerprint.json'
 assert hashlib.sha256(fingerprint.read_bytes()).hexdigest()==OLD,'FINGERPRINT_CHANGED_REVIEW_REQUIRED'
 m=json.loads(fingerprint.read_text())
 assert all(hashlib.sha256((ROOT/k).read_bytes()).hexdigest()==v for k,v in m['files'].items()),'ENGINE_CHANGED'
 backup=STAGE/'before_install';backup.mkdir(exist_ok=False)
 with ProcessLock(ROOT/'read_only/demo_bridge.lock'),ArcRunnerLock(lock_key=LOCK_KEY):
  db=sqlite3.connect(ROOT/'read_only/demo_bridge.sqlite3',isolation_level=None)
  try:
   assert db.execute('SELECT request_id FROM active_run').fetchone()[0]==RID,'RUN_CHANGED'
   assert not db.execute("SELECT 1 FROM receipts WHERE status IN ('UNCERTAIN','PROCESSING')").fetchone(),'UNCERTAIN_COMMAND'
   row=db.execute('SELECT payload,status FROM receipts WHERE id=?',(RID,)).fetchone();cmd=json.loads(row[0])
   assert row[1]=='APPLIED' and cmd['action']=='START' and cmd['requestId']==RID,'RECEIPT_MISMATCH'
   a=MT5ArcAdapter(mt5,allow_execution=False);a.initialize()
   proof=prove_risk_stop(ROOT,RID,a,ArcLedger,IDENTITY)
   backupdb=sqlite3.connect(backup/'demo_bridge.sqlite3');db.backup(backupdb);backupdb.close()
   shutil.copyfile(fingerprint,backup/fingerprint.name)
   for name in ['bridge.py','v51_dashboard_runtime.py','v51_terminal_reconciliation.py']:
    content=(STAGE/name).read_bytes();compile(content,name,'exec')
    if (ROOT/name).exists():shutil.copyfile(ROOT/name,backup/name)
    (ROOT/name).write_bytes(content);m['files'][name]=hashlib.sha256(content).hexdigest()
   atomic_json(fingerprint,m)
   proof=prove_risk_stop(ROOT,RID,a,ArcLedger,IDENTITY)
   db.execute('BEGIN IMMEDIATE')
   try:
    assert not db.execute("SELECT 1 FROM receipts WHERE status IN ('UNCERTAIN','PROCESSING')").fetchone()
    db.execute('CREATE TABLE IF NOT EXISTS recovery_audit(request_id TEXT PRIMARY KEY,proof TEXT NOT NULL,at_ms INTEGER NOT NULL)')
    db.execute('INSERT INTO recovery_audit VALUES(?,?,?)',(RID,json.dumps(proof),int(time.time()*1000)))
    assert db.execute('UPDATE active_run SET request_id=NULL WHERE singleton=1 AND request_id=?',(RID,)).rowcount==1
    db.execute('COMMIT')
   except BaseException:db.execute('ROLLBACK');raise
   proof.update(installed_files={n:m['files'][n] for n in ['bridge.py','v51_dashboard_runtime.py','v51_terminal_reconciliation.py']},fingerprint_sha256=hashlib.sha256(fingerprint.read_bytes()).hexdigest(),old_batch_restarted=False,receipt_status='APPLIED',new_cycle_started=False)
   atomic_json(STAGE/'repair_receipt.json',proof);print(json.dumps(proof))
  finally:mt5.shutdown();db.close()
if __name__=='__main__':main()
