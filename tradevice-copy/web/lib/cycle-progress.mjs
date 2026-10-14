import {validateBatch} from './demo-batch.mjs';
/** Display evidence only. Neither cycle count nor progress authorizes a command. */
export function cycleProgress(raw,runtime,now=Date.now(),requestId=null){
 const b=validateBatch(raw,now);
 if(!b)return null;
 const running=['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state);
 const latest=requestId||(running?runtime?.commands?.find(c=>c.action==='START'&&['PENDING','DISPATCHED','APPLIED','UNCERTAIN'].includes(c.status))?.requestId:null);
 if(latest&&b.batch_id!=='v51_dashboard_'+latest.replaceAll('-',''))return null;
 const executed=b.cycles.some(c=>c.layers>0);
 const fresh=b.fresh&&runtime?.online===true&&Number.isSafeInteger(runtime.observedMs)&&now>=runtime.observedMs&&now-runtime.observedMs<=8000;
 return {batchId:b.batch_id,current:b.started,total:b.requested,completed:b.completed,executed,executedCount:b.cycles.filter(c=>c.layers>0).length,
  percent:100*b.completed/b.requested,fresh,active:fresh&&running&&b.status==='RUNNING',status:b.status};
}
