const EVENTS=new Set('ARC_NAMESPACE BATCH_STARTED BATCH_CYCLE_RESULT CYCLE_STARTED FIXED_INITIAL_LADDERS_VERIFIED BROKER_REQUEST_INTENT BROKER_REQUEST_RECEIPT BROKER_REQUEST_RESOLVED FLAT_LIFECYCLE_RECONCILED TERMINAL_EXIT_COMMITTED TP_GENERATION_BEGIN TP_GENERATION_SYNCED NEWS_ENTRY_SUSPENDED NEWS_PENDING_RETIRED ADAPTIVE_ARMED ADAPTIVE_AUTHORIZED ADAPTIVE_DEFERRED ADAPTIVE_FILLED RISK_EXIT_COMMITTED'.split(' '));
export function validateTerminal(p,now=Date.now()){
 if(!p||p.schema!=='tradevice.powershell.journal.v1'||p.source!=='TRADEVICEPC_POWERSHELL_JOURNAL_VIEWER'||p.readOnly!==true||!Number.isSafeInteger(p.observedMs)||p.observedMs<0||p.observedMs>now||!['LIVE','NO_EVENTS','UNAVAILABLE','STALE'].includes(p.status)||!Array.isArray(p.lines)||p.lines.length>40)return null;
 if(p.batchId!==null&&(typeof p.batchId!=='string'||!/^(v51_dashboard_[a-f0-9]{32}|v51_demo10_[0-9]{8}_[0-9]{6})$/.test(p.batchId)))return null;
 if(p.status==='LIVE'&&(!p.batchId||!p.lines.length)||['NO_EVENTS','UNAVAILABLE'].includes(p.status)&&p.lines.length)return null;
 const seen=new Set(),lines=[];
 for(const e of p.lines){
  if(!e||!Number.isSafeInteger(e.atMs)||e.atMs<0||e.atMs>p.observedMs||!EVENTS.has(e.event)||!Number.isSafeInteger(e.sequence)||e.sequence<0||e.sequence>1e9||e.cycle!==null&&(typeof e.cycle!=='string'||!/^[a-f0-9]{8}$/.test(e.cycle)))return null;
  const key=e.cycle+':'+e.sequence;if(seen.has(key))return null;seen.add(key);
  lines.push({atMs:e.atMs,event:e.event,cycle:e.cycle,sequence:e.sequence});
 }
 return {schema:p.schema,source:p.source,readOnly:true,observedMs:p.observedMs,batchId:p.batchId,status:now-p.observedMs>12000?'STALE':p.status,lines};
}
export function terminalText(p){return p.lines.map(e=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(e.atMs))+' WIB  '+(e.cycle||'BATCH')+'  '+e.event+'  #'+e.sequence).join('\n');}
