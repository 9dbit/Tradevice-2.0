"""Prove an intentional risk stop without dispatching or changing historical journals."""
import hashlib,json,uuid
from pathlib import Path
RISK_STOP_MESSAGE='Risk exit/arm rollback: no subsequent batch cycle'
RISK_STOP_FLAT='RISK_STOP_FLAT'

def prove_risk_stop(root,request_id,adapter,ledger_factory,expected_identity):
 root=Path(root).resolve();rid=str(uuid.UUID(request_id))
 folder=root/'logs'/'arc_v1'/('v51_dashboard_'+rid.replace('-',''))
 manifest=folder/'batch_manifest.json';raw=manifest.read_bytes();m=json.loads(raw)
 if (m.get('status')!='SAFETY_STOP' or m.get('no_new_cycle') is not True or m.get('active_slot') is not None
     or m.get('error')!="ArcSafetyError("+repr(RISK_STOP_MESSAGE)+")" or m.get('identity')!=list(expected_identity)):
  raise ValueError('TERMINAL_STOP_PROOF_MISMATCH')
 slots=m.get('slots');limit=m.get('max_cycles')
 if type(limit) is not int or not 1<=limit<=10 or not isinstance(slots,list) or not 1<=len(slots)<=limit:raise ValueError('TERMINAL_SLOTS_INVALID')
 adapter.guard_identity()
 def flat():
  p,o=adapter.mt5.positions_get(),adapter.mt5.orders_get()
  if p is None or o is None or p or o:raise ValueError('BROKER_NOT_FLAT')
 flat();proof=[];seen=set();files=[]
 for i,s in enumerate(slots,1):
  cid=s.get('cycle_id');result=s.get('result',{});directory=folder/f'cycle_{i:02d}'
  if s.get('number')!=i or not isinstance(cid,str) or cid in seen or Path(s.get('state_dir','')).resolve()!=directory.resolve():raise ValueError('TERMINAL_SLOT_MISMATCH')
  seen.add(cid);p=directory/'arc_state.json';before=p.read_bytes();state=json.loads(before)
  if (state.get('cycle_id')!=cid or state.get('broker_flat_confirmed') is not True or not str(state.get('state','')).startswith('COMPLETE')
      or result.get('cycle_id')!=cid or result.get('broker_flat_confirmed') is not True or result.get('outcome')!=state['state']):raise ValueError('TERMINAL_CYCLE_UNFINISHED')
  ledger=ledger_factory(directory);tail=ledger.tail
  if ledger.unresolved_requests():raise ValueError('TERMINAL_REQUEST_UNRESOLVED')
  life=adapter.cycle_lifecycle(cid)
  if life.get('all_closed') is not True or not life.get('entry_deals') or not life.get('exit_deals'):raise ValueError('TERMINAL_HISTORY_UNCONFIRMED')
  if p.read_bytes()!=before or ledger_factory(directory).tail!=tail:raise ValueError('TERMINAL_JOURNAL_CHANGED')
  files.append((p,before,directory,tail));proof.append({'cycle_id':cid,'state_sha256':hashlib.sha256(before).hexdigest(),'ledger_tail':tail})
 # Only the filled risk-exit path is handled. Rollback and all other errors remain blocked.
 if slots[-1]['result'].get('outcome')!='COMPLETE_RISK_EXIT':raise ValueError('NOT_COMPLETED_RISK_EXIT')
 flat()
 if manifest.read_bytes()!=raw or any(p.read_bytes()!=before or ledger_factory(d).tail!=tail for p,before,d,tail in files):raise ValueError('TERMINAL_JOURNAL_CHANGED')
 return {'request_id':rid,'batch_id':folder.name,'manifest_sha256':hashlib.sha256(raw).hexdigest(),'cycles':proof,'broker_flat':True,'orders_sent':0}
