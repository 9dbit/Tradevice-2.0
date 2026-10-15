/** Display only: never turns stale or recovery evidence into authorization. */
const activeStates=new Set(['STARTING','RUNNING','PAUSING','STOPPING']);
const startChecks=['identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash'];
const startOnlyBlockers=new Set(['ENGINE_NOT_READY',...startChecks.map(k=>'PREFLIGHT_'+k.toUpperCase())]);
export function preflightDeferred(runtime,fresh){
 return !!(fresh&&runtime&&activeStates.has(runtime.state)&&
  !runtime.blockers.some(b=>/RECOVERY|RECONCILIATION|UNRESOLVED/.test(b)));
}
function explicitFailure(runtime,key){
 const blockers=runtime?.blockers??[];
 return key==='news'&&blockers.includes('NEWS_NOT_CLEAR')||
  key==='engineHash'&&blockers.includes('ENGINE_FINGERPRINT_MISMATCH');
}
export function preflightVerified(runtime,fresh,key){
 if(!fresh||!runtime||explicitFailure(runtime,key)||preflightDeferred(runtime,fresh))return false;
 if(key==='engineReady')return runtime.canStart===true&&runtime.blockers.length===0&&runtime.state!=='RECOVERY_REQUIRED';
 if(key==='reconciled'&&(runtime.state==='RECOVERY_REQUIRED'||runtime.blockers.some(b=>/RECOVERY|RECONCILIATION|UNRESOLVED/.test(b))))return false;
 return runtime.checks?.[key]===true;
}
export function preflightStatus(runtime,fresh,key){
 if(!runtime)return 'Unavailable';
 if(!fresh)return 'Stale';
 if(explicitFailure(runtime,key))return 'Blocked';
 if(preflightDeferred(runtime,fresh))return 'Deferred';
 if(preflightVerified(runtime,fresh,key))return 'Verified';
 if(key==='engineReady'||key==='reconciled'&&(runtime.state==='RECOVERY_REQUIRED'||runtime.blockers.some(b=>/RECOVERY|RECONCILIATION|UNRESOLVED/.test(b))))return 'Blocked';
 return runtime.checks?.[key]===false?'Blocked':'Unavailable';
}
export function preflightBlockers(runtime,fresh){
 // The API projects new-START blockers even while the execution thread owns MT5.
 // Only that exact derived set is deferred. News, fingerprint, safety, command,
 // recovery and unknown engine reasons remain visible. The runtime is unmodified.
 const deferred=preflightDeferred(runtime,fresh);
 return (runtime?.blockers??[]).filter(b=>!deferred||!startOnlyBlockers.has(b));
}
