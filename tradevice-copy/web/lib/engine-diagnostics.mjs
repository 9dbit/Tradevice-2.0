const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e12;
const fresh=(t,now,ttl)=>Number.isSafeInteger(t)&&t>=0&&now-t>=0&&now-t<=ttl;
export function validateEngine(raw,now=Date.now()){
 const empty={status:'ENGINE_NOT_CONNECTED',observedMs:null,cycleId:null,state:null,hardLossUsd:null,targetUsd:null,
 riskExitCommitted:null,brokerFlatReconciled:null,entrySuspended:null,pnl:null,decision:null,
 authorization:'UNKNOWN',authorizationExpiresMs:null,orderDispatchAuthorized:false};
 if(!raw||raw.orderDispatchAuthorized!==false)return empty;
 if(['ENGINE_NOT_CONNECTED','ENGINE_REPORT_STALE','ENGINE_REPORT_INVALID'].includes(raw.status))return {...empty,status:raw.status};
 const invalid={...empty,status:'ENGINE_REPORT_INVALID'};
 if(raw.status!=='ENGINE_REPORTED'||!fresh(raw.observedMs,now,8000))return {...empty,status:'ENGINE_REPORT_STALE'};
 if((raw.cycleId!==null&&(typeof raw.cycleId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.cycleId)))||
 typeof raw.state!=='string'||!/^[A-Z_]{1,48}$/.test(raw.state)||raw.hardLossUsd!==-120||raw.targetUsd!==3.5||
 ['riskExitCommitted','brokerFlatReconciled','entrySuspended'].some(k=>typeof raw[k]!=='boolean')||
 (raw.brokerFlatReconciled&&!raw.state.startsWith('COMPLETE')))return invalid;
 if(!['UNKNOWN','NONE','AUTHORIZED','EXPIRED','DEFERRED','FILLED'].includes(raw.authorization))return invalid;
 let authorization=raw.authorization;
 if(raw.authorizationExpiresMs!==null&&(!Number.isSafeInteger(raw.authorizationExpiresMs)||raw.authorizationExpiresMs<0))return invalid;
 if(authorization==='AUTHORIZED'&&(raw.authorizationExpiresMs===null||now>=raw.authorizationExpiresMs))authorization='EXPIRED';
 let pnl=null,decision=null;
 if(raw.pnl){const p=raw.pnl;if(!finite(p.value)||p.basis!=='ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED'||!raw.cycleId)return invalid;
 if(fresh(p.atMs,now,5000)&&fresh(p.tickMs,now,5000)&&!raw.state.startsWith('COMPLETE'))pnl={value:p.value,atMs:p.atMs,tickMs:p.tickMs,basis:p.basis};}
 if(raw.decision){const d=raw.decision;
 if(!Number.isInteger(d.layer)||d.layer<6||d.layer>10||typeof d.accepted!=='boolean'||
 (d.structuralReversal!==null&&typeof d.structuralReversal!=='boolean')||
 !['distance_points','atr','body_atr','body_range'].every(k=>finite(d[k]))||
 !Array.isArray(d.reasons)||d.reasons.length<1||d.reasons.length>8||d.reasons.some(r=>typeof r!=='string'||!/^[A-Z0-9_]{1,80}$/.test(r)))return invalid;
 if(fresh(d.candleCloseMs,now,120000))decision={layer:d.layer,candleCloseMs:d.candleCloseMs,accepted:d.accepted,
 structuralReversal:d.structuralReversal,distance_points:d.distance_points,atr:d.atr,body_atr:d.body_atr,body_range:d.body_range,reasons:[...d.reasons]};}
 return {...empty,status:raw.status,observedMs:raw.observedMs,cycleId:raw.cycleId,state:raw.state,
 hardLossUsd:-120,targetUsd:3.5,riskExitCommitted:raw.riskExitCommitted,brokerFlatReconciled:raw.brokerFlatReconciled,
 entrySuspended:raw.entrySuspended,pnl,decision,authorization,authorizationExpiresMs:raw.authorizationExpiresMs};
}
export function validateOwned(raw){
 if(!raw||raw.basis!=='MAGIC_SYMBOL_OPEN_PROFIT_PLUS_SWAP'||raw.netCyclePnlVerified!==false||
 raw.currency!=='USD'||!finite(raw.value)||![raw.positions,raw.pending].every(x=>Number.isSafeInteger(x)&&x>=0)||
 (raw.positions===0&&raw.value!==0))return null;
 return {value:raw.value,currency:'USD',positions:raw.positions,pending:raw.pending,basis:raw.basis,netCyclePnlVerified:false};
}
