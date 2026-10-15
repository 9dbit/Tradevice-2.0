/** Display only: never turns stale or recovery evidence into authorization. */
export function preflightVerified(runtime,fresh,key){
 if(!fresh||!runtime)return false;
 if(key==='engineReady')return runtime.canStart===true&&runtime.blockers.length===0&&runtime.state!=='RECOVERY_REQUIRED';
 if(key==='reconciled'&&(runtime.state==='RECOVERY_REQUIRED'||runtime.blockers.some(b=>/RECOVERY|RECONCILIATION|UNRESOLVED/.test(b))))return false;
 return runtime.checks?.[key]===true;
}
