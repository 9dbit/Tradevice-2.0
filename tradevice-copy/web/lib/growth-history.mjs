/** Recorded realized P&L only. No balance, percentage return or synthetic equity. */
export function validateGrowth(p,now=Date.now()){
 if(!p||p.schema!=='tradevice.growth.v1'||p.source!=='TRADEVICEPC_V51_COMPLETED_JOURNALS'||p.readOnly!==true||p.currency!=='USD'||!Number.isSafeInteger(p.observedMs)||p.observedMs<0||p.observedMs>now||!['AVAILABLE','PARTIAL','UNAVAILABLE'].includes(p.status)||!Array.isArray(p.rows)||p.rows.length>2000)return null;
 if(p.status==='UNAVAILABLE'){if(p.rows.length||p.coverageStartMs!==null)return null;}
 else if(!Number.isSafeInteger(p.coverageStartMs)||p.coverageStartMs<0||p.coverageStartMs>p.observedMs)return null;
 let last=-1;const ids=new Set(),rows=[];
 for(const r of p.rows){
  if(!r||typeof r.cycleId!=='string'||!/^[a-f0-9]{8}$/.test(r.cycleId)||ids.has(r.cycleId)||!Number.isSafeInteger(r.closedMs)||r.closedMs<p.coverageStartMs||r.closedMs>p.observedMs||r.closedMs<last||typeof r.netUsd!=='number'||!Number.isFinite(r.netUsd)||Math.abs(r.netUsd)>1e9)return null;
  ids.add(r.cycleId);last=r.closedMs;rows.push({cycleId:r.cycleId,closedMs:r.closedMs,netUsd:r.netUsd});
 }
 return {schema:p.schema,source:p.source,readOnly:true,currency:'USD',observedMs:p.observedMs,coverageStartMs:p.coverageStartMs,status:p.status,stale:p.stale===true||now-p.observedMs>180000,rows};
}
export function wibInput(ms){return new Date(ms+7*3600000).toISOString().slice(0,16);}
export function durationMs(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return NaN;const ms=Date.parse(value+':00+07:00');return Number.isFinite(ms)&&wibInput(ms)===value?ms:NaN;}
export function growthSeries(raw,period,now=Date.now(),from='',to=''){
 const p=validateGrowth(raw,now);if(!p||p.status==='UNAVAILABLE')return {status:'UNAVAILABLE',points:[],net:null};
 const periods={Hour:3600000,Day:86400000,Week:7*86400000,Month:30*86400000,Year:365*86400000};
 const start=period==='Duration'?durationMs(from):now-periods[period],end=period==='Duration'?durationMs(to):now;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end>now)return {status:'INVALID_RANGE',points:[],net:null};
 const rows=p.rows.filter(r=>r.closedMs>=start&&r.closedMs<=end);let sum=0;
 const points=rows.map(r=>({...r,total:sum=Math.round((sum+r.netUsd)*1e8)/1e8}));
 return {status:points.length?'AVAILABLE':'EMPTY',points,net:points.length?sum:null,start:Math.max(start,p.coverageStartMs),end:Math.min(end,p.observedMs),requestedStart:start,partial:p.status==='PARTIAL'||start<p.coverageStartMs,stale:p.stale,observedMs:p.observedMs,coverageStartMs:p.coverageStartMs};
}
