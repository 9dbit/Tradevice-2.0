/** Terminal evidence only: never authorize a reset to send a command. */
export function batchStopNotice(progress,runtimeRunning){
 if(!progress||runtimeRunning||!['STOPPED','SAFETY_STOP','BLOCKED'].includes(progress.status))return null;
 if(progress.status==='STOPPED'&&progress.completed>=progress.total)return null;
 let reason=progress.blockers?.join(' · ');
 if(!reason){
  if(progress.lastOutcome?.includes('RISK'))reason='Basket risk limit reached. Remaining cycles were stopped for safety.';
  else if(progress.lastOutcome==='COMPLETE_BROKER_CLOSED'||progress.lastOutcome==='COMPLETE_TERMINAL_CLEANUP')reason='Broker-side closure required terminal cleanup. Automatic continuation was blocked.';
  else if(progress.lastOutcome?.includes('NEWS'))reason='News protection suspended entries and stopped this batch.';
  else reason='The engine reported a terminal stop. No detailed stop reason was supplied.';
 }
 return {key:progress.batchId+':'+progress.status,title:'Trading batch stopped',reason,resetSafe:progress.unfinished===0};
}
