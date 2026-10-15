/** Terminal evidence only: never authorize a reset to send a command. */
export function batchStopNotice(progress,runtimeRunning){
 if(!progress||runtimeRunning||!['STOPPED','SAFETY_STOP','BLOCKED'].includes(progress.status))return null;
 if(progress.status==='STOPPED'&&progress.completed>=progress.total)return null;
 const reasons={
  OPERATOR_EMERGENCY_CLOSE:'Emergency close completed. Positions and pending orders are verified empty; this batch will not resume.',
  BROKER_REJECT_10013:'The broker rejected an order update (10013: Invalid request). The batch stopped; reconciliation is required.',
  BATCH_SAFETY_STOP:'The engine stopped after a safety check failed. Broker reconciliation is required.',
  BROKER_TP_AFTER_SAFETY_STOP:'The remaining position closed at broker TP after the safety stop. Broker-flat reconciliation is verified; this batch will not resume.',
 };
 let reason=progress.blockers?.map(code=>reasons[code]||code).join(' · ');
 if(!reason){
  if(progress.lastOutcome?.includes('RISK'))reason='Basket risk limit reached. Remaining cycles were stopped for safety.';
  else if(progress.lastOutcome==='COMPLETE_BROKER_CLOSED'||progress.lastOutcome==='COMPLETE_TERMINAL_CLEANUP')reason='Broker-side closure required terminal cleanup. Automatic continuation was blocked.';
  else if(progress.lastOutcome?.includes('NEWS'))reason='News protection suspended entries and stopped this batch.';
  else reason='The engine reported a terminal stop. No detailed stop reason was supplied.';
 }
 return {key:progress.batchId+':'+progress.status,title:'Trading batch stopped',reason,resetSafe:progress.unfinished===0};
}
