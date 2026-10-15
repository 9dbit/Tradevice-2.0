"""Read-only proof of an owned basket closed manually after the specific safety stop."""
import hashlib,json,math,uuid
from pathlib import Path

MANUAL_STOP_ERROR="ArcSafetyError('Foreign symbol/magic exposure in broker account')"

def prove_manual_stop(root,request_id,adapter,ledger_factory,expected_identity):
 root=Path(root).resolve();rid=str(uuid.UUID(request_id))
 folder=root/'logs/arc_v1'/('v51_dashboard_'+rid.replace('-',''))
 files={str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file()}
 m=json.loads((folder/'batch_manifest.json').read_text());slots=m.get('slots')
 if m.get('status')!='SAFETY_STOP' or m.get('error')!=MANUAL_STOP_ERROR or m.get('identity')!=list(expected_identity):raise ValueError('MANUAL_STOP_MANIFEST_MISMATCH')
 if not isinstance(slots,list) or len(slots)!=1 or m.get('active_slot')!=1:raise ValueError('MANUAL_STOP_SLOT_MISMATCH')
 s=slots[0];directory=folder/'cycle_01';state=json.loads((directory/'arc_state.json').read_text());cid=s.get('cycle_id')
 if (s.get('number')!=1 or Path(s.get('state_dir','')).resolve()!=directory or state.get('cycle_id')!=cid
     or state.get('state')!='SAFETY_PAUSED' or state.get('safety_paused') is not True
     or state.get('block_next_cycle') is not True or s.get('result',{}).get('outcome')!='SAFETY_STOP'):
  raise ValueError('MANUAL_STOP_STATE_MISMATCH')
 adapter.guard_identity()
 def flat():
  p,o=adapter.mt5.positions_get(),adapter.mt5.orders_get()
  if p is None or o is None or p or o:raise ValueError('MANUAL_STOP_BROKER_NOT_FLAT')
 flat();ledger=ledger_factory(directory);tail=ledger.tail
 if ledger.unresolved_requests() or ledger_factory(folder).unresolved_requests():raise ValueError('MANUAL_STOP_UNRESOLVED_REQUEST')
 def history():
  life=adapter.cycle_lifecycle(cid);entries=life.get('entry_deals',());exits=life.get('exit_deals',())
  if life.get('all_closed') is not True or not entries or not exits:raise ValueError('MANUAL_STOP_HISTORY_INCOMPLETE')
  ids={int(d.position_id) for d in entries};prefix='GT_ARC_V1:'+cid+':'
  if any(d.magic!=adapter.cfg.magic or d.symbol!='XAUUSDm' or not d.comment.startswith(prefix) for d in entries):raise ValueError('MANUAL_STOP_ENTRY_NOT_OWNED')
  if any(d.symbol!='XAUUSDm' or int(d.position_id) not in ids or d.reason!=0 for d in exits):raise ValueError('MANUAL_STOP_EXIT_NOT_PROVEN')
  for pid in ids:
   en=sum(float(d.volume) for d in entries if d.position_id==pid);ex=sum(float(d.volume) for d in exits if d.position_id==pid)
   if en<=0 or not math.isclose(en,ex,rel_tol=0,abs_tol=1e-9):raise ValueError('MANUAL_STOP_VOLUME_MISMATCH')
  net=sum(float(getattr(d,k,0)) for d in (*entries,*exits) for k in ('profit','commission','swap','fee'))
  if not math.isfinite(net) or not math.isclose(net,float(life['net_pl']),abs_tol=1e-9):raise ValueError('MANUAL_STOP_NET_MISMATCH')
  signature=sorted((int(d.ticket),int(d.position_id),int(d.entry),float(d.volume),float(d.price),float(getattr(d,'profit',0)),float(getattr(d,'commission',0)),float(getattr(d,'swap',0)),float(getattr(d,'fee',0))) for d in (*entries,*exits))
  return net,len(ids),hashlib.sha256(json.dumps(signature).encode()).hexdigest()
 net,count,digest=history();flat()
 if history()!=(net,count,digest) or ledger_factory(directory).tail!=tail:raise ValueError('MANUAL_STOP_HISTORY_CHANGED')
 after={str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file()}
 if files!=after:raise ValueError('MANUAL_STOP_JOURNAL_CHANGED')
 return dict(request_id=rid,batch_id=folder.name,cycle_id=cid,files=files,ledger_tail=tail,history_sha256=digest,
  positions_closed=count,net_usd=net,broker_flat=True,outcome='COMPLETE_MANUAL_CLOSE_RECONCILED',orders_sent=0,original_journals_modified=False)
