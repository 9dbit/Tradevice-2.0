/** Presentation only. A command receipt is not proof that a basket has closed. */
export function commandMessage(request,runtime,fresh){
 if(request.error)return request.error;
 if(['SENDING','PENDING','DISPATCHED'].includes(request.phase))return 'Awaiting engine confirmation…';
 if(request.phase!=='APPLIED')return 'Not confirmed. Check command history before retrying.';
 if(!fresh)return 'Command applied. Current engine state is unavailable; completion is not verified.';
 if(request.action==='STOP'){
  if(runtime?.state==='STOPPED'&&runtime?.automatic?.enabled!==true)return 'Stop confirmed · Automatic off. Engine stopped.';
  return 'Stop accepted. Waiting for the engine to stop; any open basket remains supervised.';
 }
 if(request.action==='PAUSE'){
  if(runtime?.state==='PAUSED'&&runtime?.automatic?.enabled!==true)return 'Pause confirmed · Automatic off.';
  return 'Pause accepted. Waiting for the engine to pause; any open basket remains supervised.';
 }
 if(request.action==='START'&&request.mode==='AUTOMATIC'){
  if(runtime?.automatic?.enabled!==true)return 'Automatic enable command applied. Automatic is currently off.';
  return runtime.state==='AUTO_WAITING'?'Automatic enabled · waiting for all entry checks. No new cycle is authorized until they pass.':'Automatic enabled. See the engine state and matched cycle evidence below.';
 }
 return 'Start command applied. See the engine state and matched cycle evidence; this receipt alone does not confirm an open position.';
}
export function engineStatus(runtime,fresh,selectedChecked){
 if(!fresh)return 'State unavailable';
 const states={AUTO_WAITING:'Automatic · waiting',STARTING:'Starting',RUNNING:'Running',PAUSING:'Pausing',PAUSED:'Paused',STOPPING:'Stopping',STOPPED:'Stopped',RECOVERY_REQUIRED:'Recovery required'};
 return states[runtime?.state]||(runtime?.canStart?(selectedChecked?'Ready':'Check settings'):'Blocked');
}
export function automaticMessage(runtime,fresh){
 if(!fresh)return 'Automatic state unavailable · waiting for fresh engine evidence.';
 if(!runtime?.automatic)return 'Automatic support has not been confirmed by this engine.';
 if(!runtime.automatic.enabled)return 'Automatic off. Selecting this mode does not enable it; use Enable Automatic to arm it.';
 return `Automatic enabled · ${runtime.automatic.completedCycles} cycles completed in this activation. ${runtime.state==='AUTO_WAITING'?'Waiting for every entry check to pass.':'Current cycle remains supervised.'}`;
}
