const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e12;
const fresh=(t,now,ttl)=>Number.isSafeInteger(t)&&t>=0&&now-t>=0&&now-t<=ttl;
export function validateEngine(raw,now=Date.now()){
 const empty={policy:null,status:'ENGINE_NOT_CONNECTED',observedMs:null,cycleId:null,state:null,hardLossUsd:null,targetUsd:null,tpAtrValue:null,tpMultiplier:null,tpAtrCandleMs:null,tpAtrFresh:null,tpBasis:null,tpDistancePrice:null,tpDistancePoints:null,targetPrice:null,
 riskExitCommitted:null,brokerFlatReconciled:null,entrySuspended:null,pnl:null,decision:null,
 authorization:'UNKNOWN',authorizationExpiresMs:null,orderDispatchAuthorized:false};
 if(!raw||raw.orderDispatchAuthorized!==false)return empty;
 if((['ENGINE_NOT_CONNECTED','ENGINE_REPORT_INVALID'].includes(raw.status)||(raw.status==='ENGINE_REPORT_STALE'&&raw.observedMs==null)))return {...empty,status:raw.status};
 const policy=raw.policy??'REVERSAL_RISK_V5';
 const invalid={...empty,status:'ENGINE_REPORT_INVALID'};
 if(!['REVERSAL_RISK_V5','CLOSE_DISTANCE_RISK_V51'].includes(policy))return invalid;
 if(!['ENGINE_REPORTED','ENGINE_REPORT_STALE'].includes(raw.status)||!fresh(raw.observedMs,now,604800000))return {...empty,status:'ENGINE_REPORT_STALE'};
 if((raw.cycleId!==null&&(typeof raw.cycleId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.cycleId)))||
 typeof raw.state!=='string'||!/^[A-Z_]{1,48}$/.test(raw.state)||!(policy==='CLOSE_DISTANCE_RISK_V51'?[-250,-350]:[-120]).includes(raw.hardLossUsd)||
 ['riskExitCommitted','brokerFlatReconciled','entrySuspended'].some(k=>typeof raw[k]!=='boolean')||
 (raw.brokerFlatReconciled&&!raw.state.startsWith('COMPLETE')))return invalid;
 const stale=raw.status==='ENGINE_REPORT_STALE'||!fresh(raw.observedMs,now,8000);
 const tpBasis=raw.tpBasis??'PROFIT_USD',tpDistancePrice=raw.tpDistancePrice??null,tpDistancePoints=raw.tpDistancePoints??null,targetPrice=raw.targetPrice??null;
 const tpAtrValue=raw.tpAtrValue??null,tpMultiplier=raw.tpMultiplier??null,tpAtrCandleMs=raw.tpAtrCandleMs??null;
 let tpAtrFresh=null;
 if(tpBasis==='ATR_CURRENT_USD'){
  if(policy!=='CLOSE_DISTANCE_RISK_V51'||tpDistancePrice!==null||tpDistancePoints!==null||!finite(tpAtrValue)||tpAtrValue<=0||![1,2].includes(tpMultiplier)||raw.hardLossUsd!==(tpMultiplier===1?-250:-350)||!finite(raw.targetUsd)||Math.abs(raw.targetUsd-tpAtrValue*tpMultiplier)>1e-8||!Number.isSafeInteger(tpAtrCandleMs)||typeof raw.tpAtrFresh!=='boolean')return invalid;
  tpAtrFresh=raw.tpAtrFresh&&fresh(tpAtrCandleMs,now,120000);
 }else if(['ATR_PRICE_DISTANCE','POINTS_PRICE_DISTANCE'].includes(tpBasis)){
  if(policy!=='CLOSE_DISTANCE_RISK_V51'||!finite(tpDistancePrice)||tpDistancePrice<=0||tpDistancePrice>1e6||!finite(tpDistancePoints)||tpDistancePoints<=0||tpDistancePoints>1e9||Math.abs(tpDistancePrice-tpDistancePoints*.001)>1e-8||
   (raw.targetUsd!==null&&(!finite(raw.targetUsd)||raw.targetUsd<0)))return invalid;
 }else if(tpBasis!=='PROFIT_USD'||tpDistancePrice!==null||tpDistancePoints!==null||!finite(raw.targetUsd)||raw.targetUsd<.01||raw.targetUsd>250)return invalid;
 if(tpBasis!=='ATR_CURRENT_USD'&&raw.hardLossUsd!==(policy==='CLOSE_DISTANCE_RISK_V51'?-250:-120))return invalid;
 if(targetPrice!==null&&(!finite(targetPrice)||targetPrice<=0||targetPrice>1e9))return invalid;
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
 return {...empty,policy,status:stale?'ENGINE_REPORT_STALE':'ENGINE_REPORTED',observedMs:raw.observedMs,cycleId:raw.cycleId,state:raw.state,
 hardLossUsd:raw.hardLossUsd,targetUsd:raw.targetUsd,tpAtrValue,tpMultiplier,tpAtrCandleMs,tpAtrFresh,tpBasis,tpDistancePrice,tpDistancePoints,targetPrice,riskExitCommitted:raw.riskExitCommitted,brokerFlatReconciled:stale?false:raw.brokerFlatReconciled,
 entrySuspended:raw.entrySuspended,pnl:stale?null:pnl,decision:stale?null:decision,authorization:stale?'UNKNOWN':authorization,authorizationExpiresMs:stale?null:raw.authorizationExpiresMs};
}
export function validateOwned(raw){
 if(!raw||raw.basis!=='MAGIC_SYMBOL_OPEN_PROFIT_PLUS_SWAP'||raw.netCyclePnlVerified!==false||
 raw.currency!=='USD'||!finite(raw.value)||![raw.positions,raw.pending].every(x=>Number.isSafeInteger(x)&&x>=0)||
 (raw.positions===0&&raw.value!==0))return null;
 return {value:raw.value,currency:'USD',positions:raw.positions,pending:raw.pending,basis:raw.basis,netCyclePnlVerified:false};
}
