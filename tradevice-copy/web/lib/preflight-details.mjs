import {preflightDeferred,preflightStatus} from './preflight-status.mjs';
import {selectedPreflightChecked,settingsLabel,marginRequirements,marketRequirements,failureRequirement} from './preflight-requirements.mjs';
export const checkInfo={
 identity:['Account identity','The bridge verifies the approved account, broker server and XAUUSDm symbol.','A matching broker identity and terminal connection are required.'],
 brokerFlat:['Broker flat','Checks that no positions or pending orders remain before a new batch.','A fresh broker inventory must prove zero positions and zero pending orders.'],
 quote:['Fresh quote','Checks the age and validity of the latest broker quote.','The terminal must supply a recent, valid quote while the market is available.'],
 spread:['Spread','Checks the bid/ask spread against the engine spread limit.','Wait for a fresh spread check within the configured limit.'],
 margin:['Margin','Checks free margin for the configured full L1–L10 exposure allowance plus the basket-loss reserve. Equity alone is not the capacity check.','The selected lot and TP configuration need a fresh broker margin calculation.'],
 commission:['Commission','Checks broker-deal evidence for commission and fees.','Matching broker history must support the commission assumptions.'],
 news:['News','Checks the high-impact calendar for all currencies, including the no-entry window.','A valid calendar and clearance outside the ±60 minute blackout are required. Overlapping windows extend the blackout.'],
 reconciled:['Reconciliation','Matches prior-cycle records, command receipts and broker state.','Resolve outstanding receipts and prove the previous cycle completed. Reset cannot bypass reconciliation.'],
 engineHash:['Engine hash','Verifies the loaded engine against the reviewed fingerprint and protocol.','The installed engine files and selected skill must match their approved version.'],
 atr:['ATR range','Compares ATR14 M1 with the rolling P20–P60 range from the prior 1,440 completed M1 candles.','ATR must be inside the reported range. This entry filter is separate from basket TP.'],
 adx:['ADX range','Checks ADX14 on completed M1 and M5 candles for the configured ranging condition.','Both timeframes must stay below the reported ADX limit for three completed candles each. Values update on candle completion, not each tick.'],
 engineReady:['Engine ready','Combines admission checks, selected skill acknowledgement, reconciliation and engine state.','Every required entry check must pass with fresh evidence before the engine can start a cycle.'],
};
export function factorDetails(key,runtime,settings,now){
 const info=checkInfo[key]||['Preflight','Unknown factor.','Fresh engine evidence is required.'];
 const fresh=runtime?.online===true&&Number.isFinite(runtime.observedMs)&&now-runtime.observedMs>=0&&now-runtime.observedMs<=8000;
 const deferred=preflightDeferred(runtime,fresh),checked=selectedPreflightChecked(runtime,settings,now),e=runtime?.preflightEvidence;
 const state=fresh&&!deferred&&!checked&&['margin','engineReady'].includes(key)?'Not checked':preflightStatus(runtime,fresh,key);
 const matches=b=>key==='engineReady'||b==='PREFLIGHT_'+key.toUpperCase()||({margin:/MARGIN|ECONOMICS/,adx:/ADX|MARKET_/,atr:/ATR|MARKET_/,reconciled:/RECONCIL|RECOVERY|UNRESOLVED/,engineHash:/HASH|FINGERPRINT|ACK|REVISION/,news:/NEWS/,brokerFlat:/BROKERFLAT/,quote:/QUOTE/,spread:/SPREAD/,identity:/IDENTITY/,commission:/COMMISSION/}[key]?.test(b));
 const blockers=(runtime?.blockers||[]).filter(matches);
 const rows=[['Engine state',runtime?.state||'Unavailable'],['Selected configuration',settingsLabel(settings)],['Engine-checked configuration',settingsLabel(e?.settings)]];
 if(key==='margin')rows.push(...marginRequirements(e));
 if(key==='atr'||key==='adx')rows.push(...marketRequirements(e).filter(([label])=>label.startsWith(key==='atr'?'ATR':'ADX')||label.startsWith(key==='atr'?'Allowed':'Required')));
 return {label:info[0],description:info[1],requirement:info[2],state,rows,blockers,solutions:blockers.map(failureRequirement),observedMs:e?.observedMs??runtime?.observedMs??null,
  note:state==='Not checked'?'The selected configuration has no matching fresh evidence. This does not mean insufficient equity.':state==='Deferred'?'New-entry checks are deferred while a basket is active; they do not describe live basket supervision.':state==='Stale'?'Last-known values are retained below with their original timestamp. They cannot authorize a new entry.':'These are engine observations. AI analysis is recorded separately below.'};
}
