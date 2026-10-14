/** Demo evidence is display-only and never grants execution authority. */
export function validateBatch(r,now=Date.now()){
 if(!r||r.schema!=='tradevice.v51.demo.batch.v1'||r.read_only!==true||!Number.isInteger(r.requested)||r.requested<1||r.requested>10||
 typeof r.batch_id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(r.batch_id)||
 !Number.isSafeInteger(r.observed_ms)||r.observed_ms<0||r.observed_ms>now+1000||
 !['PREFLIGHT','BLOCKED','RUNNING','COMPLETED','SAFETY_STOP','SUSPENDED','STOPPED'].includes(r.status)||
 !Array.isArray(r.blockers)||r.blockers.length>12||r.blockers.some(x=>typeof x!=='string'||!/^[A-Z0-9_]{1,80}$/.test(x))||
 !Array.isArray(r.cycles)||r.cycles.length>r.requested)return null;
 const ids=new Set(),cycles=[];
 for(const [i,c] of r.cycles.entries()){
  if(!c||c.number!==i+1||typeof c.cycle_id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(c.cycle_id)||ids.has(c.cycle_id)||
  typeof c.outcome!=='string'||!/^[A-Z_]{1,48}$/.test(c.outcome)||typeof c.broker_flat!=='boolean'||
  !Number.isInteger(c.layers)||c.layers<0||c.layers>10||typeof c.peak_lots!=='number'||!Number.isFinite(c.peak_lots)||c.peak_lots<0||c.peak_lots>100||
  (c.net_usd!==null&&(typeof c.net_usd!=='number'||!Number.isFinite(c.net_usd)||Math.abs(c.net_usd)>1e9))||
  (c.outcome.startsWith('COMPLETE')&&!c.broker_flat))return null;
  const completed=c.broker_flat&&c.outcome.startsWith('COMPLETE')&&c.layers>0;
  if(completed&&c.net_usd===null)return null;
  ids.add(c.cycle_id);cycles.push({number:i+1,cycle_id:c.cycle_id,outcome:c.outcome,broker_flat:c.broker_flat,layers:c.layers,peak_lots:c.peak_lots,net_usd:c.net_usd,completed});
 }
 const done=cycles.filter(c=>c.completed);
 if(r.status==='COMPLETED'&&done.length!==r.requested)return null;
 return {schema:r.schema,read_only:true,batch_id:r.batch_id,observed_ms:r.observed_ms,status:r.status,
 fresh:now>=r.observed_ms&&now-r.observed_ms<=15000,requested:r.requested,started:cycles.length,completed:done.length,
 wins:done.filter(c=>c.net_usd>0).length,losses:done.filter(c=>c.net_usd<0).length,
 risk_exits:done.filter(c=>c.outcome.includes('RISK')).length,unfinished:cycles.filter(c=>!c.broker_flat).length,
 net_completed_usd:Math.round(done.reduce((s,c)=>s+c.net_usd,0)*1e8)/1e8,blockers:[...r.blockers],cycles};
}
