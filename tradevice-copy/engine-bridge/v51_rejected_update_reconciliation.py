"""Read-only proof: exact rejected pending update, then protected broker TP."""
import hashlib,json,math,uuid
from pathlib import Path

STOP_ERROR="ArcDefinitiveReject('MT5 order_send rejected retcode=10013')"

def prove_rejected_update_stop(root,request_id,adapter,ledger_factory,expected_identity):
 root=Path(root).resolve();rid=str(uuid.UUID(request_id))
 folder=root/'logs/arc_v1'/('v51_dashboard_'+rid.replace('-',''))
 def hashes():return {str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file()}
 files=hashes();m=json.loads((folder/'batch_manifest.json').read_text());slots=m.get('slots')
 if (m.get('status')!='SAFETY_STOP' or m.get('error')!=STOP_ERROR or m.get('identity')!=list(expected_identity)
     or m.get('no_new_cycle') is not True or m.get('cleanup_status')!='PROTECTED'):
  raise ValueError('TP_STOP_MANIFEST_MISMATCH')
 if not isinstance(slots,list) or len(slots)!=1 or m.get('active_slot')!=1:raise ValueError('TP_STOP_SLOT_MISMATCH')
 slot=slots[0];directory=folder/'cycle_01';state=json.loads((directory/'arc_state.json').read_text());cid=slot.get('cycle_id')
 if (slot.get('number')!=1 or Path(slot.get('state_dir','')).resolve()!=directory or state.get('cycle_id')!=cid
     or state.get('state')!='SAFETY_PAUSED' or state.get('safety_paused') is not True
     or state.get('block_next_cycle') is not True or state.get('paused_broker_tp_verified') is not True
     or state.get('paused_pending_count')!=0 or slot.get('result',{}).get('outcome')!='SAFETY_STOP'):
  raise ValueError('TP_STOP_STATE_MISMATCH')
 adapter.guard_identity()
 def flat():
  p,o=adapter.mt5.positions_get(),adapter.mt5.orders_get()
  if p is None or o is None or p or o:raise ValueError('TP_STOP_BROKER_NOT_FLAT')
 flat();ledger=ledger_factory(directory);tail=ledger.tail;batch_ledger=ledger_factory(folder);batch_tail=batch_ledger.tail
 if ledger.unresolved_requests() or batch_ledger.unresolved_requests():raise ValueError('TP_STOP_UNRESOLVED_REQUEST')
 intents={r['request_id']:r for r in ledger.rows if r['event']=='BROKER_REQUEST_INTENT'}
 resolved={r['request_id']:r for r in ledger.rows if r['event']=='BROKER_REQUEST_RESOLVED'}
 rejected=[r for r in ledger.rows if r['event']=='BROKER_REQUEST_RECEIPT' and r.get('retcode')==10013]
 if len(rejected)!=1:raise ValueError('TP_STOP_REJECT_COUNT')
 rid_reject=rejected[0]['request_id'];intent=intents.get(rid_reject,{})
 if (intent.get('operation')!='PENDING_MODIFY' or intent.get('cycle_id')!=cid
     or resolved.get(rid_reject,{}).get('resolution')!='PROVEN_NO_EFFECT_AFTER_REJECT'):
  raise ValueError('TP_STOP_REJECT_NOT_RESOLVED')
 protected={}
 for request_id,row in intents.items():
  if row.get('operation')=='TP_SYNC' and resolved.get(request_id,{}).get('resolution')=='EFFECT_PROVEN':
   protected[row['target_ticket']]=row['expected_tp']
 def history():
  life=adapter.cycle_lifecycle(cid);entries=life.get('entry_deals',());exits=life.get('exit_deals',())
  if life.get('all_closed') is not True or not entries or not exits:raise ValueError('TP_STOP_HISTORY_INCOMPLETE')
  ids={int(d.position_id) for d in entries};prefix='GT_ARC_V1:'+cid+':'
  if any(d.magic!=adapter.cfg.magic or d.symbol!='XAUUSDm' or not d.comment.startswith(prefix) or d.entry!=0 for d in entries):
   raise ValueError('TP_STOP_ENTRY_NOT_OWNED')
  if any(d.symbol!='XAUUSDm' or d.magic!=adapter.cfg.magic or int(d.position_id) not in ids or d.reason!=5 or d.entry!=1 for d in exits):
   raise ValueError('TP_STOP_EXIT_NOT_PROVEN')
  for pid in ids:
   en=[d for d in entries if d.position_id==pid];ex=[d for d in exits if d.position_id==pid]
   if (pid not in protected or any(d.volume<=0 for d in (*en,*ex))
       or not math.isclose(sum(d.volume for d in en),sum(d.volume for d in ex),rel_tol=0,abs_tol=1e-9)):
    raise ValueError('TP_STOP_VOLUME_OR_PROTECTION_MISMATCH')
   if any(d.type!=1-en[0].type or not math.isclose(d.price,protected[pid],rel_tol=0,abs_tol=adapter.cfg.tick_size) for d in ex):
    raise ValueError('TP_STOP_PRICE_MISMATCH')
  net=sum(float(getattr(d,k,0)) for d in (*entries,*exits) for k in ('profit','commission','swap','fee'))
  if not math.isfinite(net) or not math.isclose(net,float(life['net_pl']),rel_tol=0,abs_tol=1e-9):raise ValueError('TP_STOP_NET_MISMATCH')
  signature=sorted((int(d.ticket),int(d.position_id),int(d.entry),int(d.type),int(d.reason),float(d.volume),float(d.price),float(getattr(d,'profit',0)),float(getattr(d,'commission',0)),float(getattr(d,'swap',0)),float(getattr(d,'fee',0))) for d in (*entries,*exits))
  return net,len(ids),hashlib.sha256(json.dumps(signature).encode()).hexdigest()
 net,count,digest=history();flat()
 if history()!=(net,count,digest) or ledger_factory(directory).tail!=tail or ledger_factory(folder).tail!=batch_tail or hashes()!=files:
  raise ValueError('TP_STOP_EVIDENCE_CHANGED')
 return dict(request_id=rid,batch_id=folder.name,cycle_id=cid,files=files,ledger_tail=tail,history_sha256=digest,
  positions_closed=count,net_usd=net,broker_flat=True,outcome='COMPLETE_BROKER_TP_RECONCILED',orders_sent=0,original_journals_modified=False)
