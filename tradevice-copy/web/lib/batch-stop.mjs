/** Terminal evidence only: never authorize a reset to send a command. */
export function batchStopNotice(progress,runtimeRunning){
 if(!progress||runtimeRunning||!['STOPPED','SAFETY_STOP','BLOCKED'].includes(progress.status))return null;
 if(progress.status==='STOPPED'&&progress.completed>=progress.total)return null;
 const reasons={
  ATR_OUTSIDE_RANGE:'ATR moved outside the allowed range. The batch stopped before the next cycle; the completed basket remains reconciled.',
  ADX_TREND_NOT_RANGING:'ADX no longer meets the ranging requirement. The batch stopped before the next cycle; the completed basket remains reconciled.',
  MARKET_DATA_STALE:'Fresh completed candles were unavailable before the next cycle. The batch stopped without opening that cycle.',
  MARKET_DATA_UNAVAILABLE:'Market data was unavailable before the next cycle. No new cycle was opened.',
  MARKET_HISTORY_INSUFFICIENT:'More completed M1/M5 candles are required before a new cycle.',
  MARKET_DATA_INVALID:'Market candle data failed validation. No new cycle was opened.',
  MARKET_DATA_GAP:'Recent candle history has a gap. Wait for continuous completed candles before a new cycle.',
  OPERATOR_EMERGENCY_CLOSE:'Emergency close completed. Positions and pending orders are verified empty; this batch will not resume.',
  BROKER_REJECT_10013:'The broker rejected an order update (10013: Invalid request). The batch stopped; reconciliation is required.',
  BATCH_SAFETY_STOP:'The engine stopped after a safety check failed. Positions and pending orders may still be open. Automatic basket supervision is unverified. Check broker exposure and use Close all if you want to exit; reconciliation is required.',
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
