/** Display-only diagnostics. No field here grants permission to trade. */
export function settingsMatch(a,b){
 return !!a&&!!b&&['protocol','baseLot','tpMode','customTpUsd','tpPoints'].every(k=>a[k]===b[k]);
}
export function settingsLabel(s){
 if(!s)return 'Configuration unavailable';
 return `${Number(s.baseLot).toFixed(2)} lot · ${s.tpMode==='FIXED_3_5'?'$3.50':s.tpMode==='ATR_1'?'1× ATR':s.tpMode==='ATR_2'?'2× ATR':s.tpMode==='POINTS'?`${s.tpPoints.toLocaleString('en-US')} points`:`Custom $${Number(s.customTpUsd).toFixed(2)}`}`;
}
export function selectedPreflightChecked(runtime,settings,now){
 const e=runtime?.preflightEvidence;
 return !!e&&Number.isFinite(e.observedMs)&&now-e.observedMs>=0&&now-e.observedMs<=8000&&settingsMatch(e.settings,settings);
}
const money=(n,minimum=false)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(minimum?Math.ceil((n-1e-9)*100)/100:n);
export function marginRequirements(e){
 const m=e?.margin;
 const fields=['freeMargin','usedMargin','exposureMargin','reserve','requiredFreeMargin','minimumEquity','shortfall'];
 if(m?.currency!=='USD'||!fields.every(k=>typeof m[k]==='number'&&Number.isFinite(m[k])))return [];
 return [['Minimum equity at this exposure',money(m.minimumEquity,true)],['Required free margin',money(m.requiredFreeMargin,true)],['Available free margin',money(m.freeMargin)],['Shortfall at check',money(m.shortfall,true)],['Exposure allowance',money(m.exposureMargin,true)],['Basket-loss reserve',money(m.reserve,true)]];
}
export function failureRequirement(code){
 const c=String(code||'').replace(/^SKILL_START_/,'');
 if(/MARKET_|PREFLIGHT_ATR|ATR_OUTSIDE_RANGE/.test(c))return /MARKET_/.test(c)?'ATR/ADX data is unavailable, stale or incomplete. Wait for fresh completed M1/M5 candles and sufficient broker history. Reset cannot bypass this check.':'Wait for ATR14 M1 to return within the rolling P20–P60 range shown below. This is a new-cycle entry filter, not the basket TP amount.';
 if(/ADX/.test(c))return 'Wait for ADX14 on both M1 and M5 to remain below 20 for three completed candles on each timeframe. Existing basket supervision continues.';
 if(/MARGIN_ENVELOPE_INSUFFICIENT/.test(c))return 'Insufficient free margin. Reduce the selected base lot or provide enough free margin for the calculated requirement, then run a fresh check. Reset does not change the requirement.';
 if(/MARGIN|ECONOMICS/.test(c))return 'Margin capacity is unverified. Valid broker margin calculations and current account data are required; a funding shortfall cannot be assumed.';
 if(/RECONCIL|RECOVERY|UNRESOLVED/.test(c))return 'Reconcile broker positions, pending orders and command receipts. A new batch requires verified completion of the previous cycle. Reset cannot clear this blocker.';
 if(/BROKERFLAT/.test(c))return 'Open positions or pending orders remain, or their absence is unverified. A new batch requires a fresh broker-flat check.';
 if(/ACK_MISMATCH|REVISION/.test(c))return 'Wait for the engine to acknowledge the selected skill and revision, then refresh. If the mismatch persists, the bridge and loaded skill need inspection.';
 if(/FINGERPRINT|ENGINEHASH|UPGRADE|NOT_APPROVED/.test(c))return 'The reviewed engine version or protocol must match the deployed platform. Install the reviewed update and verify its fingerprint before Start.';
 if(/SKILL_OFF/.test(c))return 'Select one approved trading skill and wait for the engine acknowledgement before Start.';
 if(/NEWS/.test(c))return 'Wait until the news blackout and cooldown end. A valid, fresh calendar and engine preflight are required.';
 if(/SPREAD/.test(c))return 'Wait for broker spread to return within the configured limit and a fresh quote check to pass.';
 if(/QUOTE/.test(c))return 'A fresh broker quote is required. Check the MT5 connection and market availability, then refresh.';
 if(/IDENTITY/.test(c))return 'The bridge must verify the approved account, server and XAUUSDm symbol. Check the MT5 connection.';
 if(/COMMISSION/.test(c))return 'The engine requires matching broker-deal history to verify commission and fees. Inspect that evidence before retrying.';
 if(/EXPIRED|UNCERTAIN|UNCONFIRMED|CONNECTION_LOST/.test(c))return 'Check command history and broker state before retrying. A missing acknowledgement does not prove that the command was not executed.';
 if(/OFFLINE|STALE|CONNECTION|UNAVAILABLE/.test(c))return 'Restore the bridge, API and MT5 connection and wait for fresh evidence. Do not retry an unconfirmed command.';
 if(/KILL|SAFETY/.test(c))return 'An operator or safety stop is active. Inspect and resolve its cause before requesting a new batch.';
 if(/SETTINGS|BOUNDED|AUTHORIZATION/.test(c))return 'Check the selected lot, TP mode and cycle count against the supported settings.';
 if(/ENGINE_NOT_READY/.test(c))return 'The engine is not ready for a new batch. Resolve the listed failed checks and wait for fresh engine acknowledgement.';
 if(/PREFLIGHT_FAILED/.test(c))return 'This rejection did not record its individual failed checks. Its historical requirement is unavailable; the current preflight is a separate observation.';
 return 'No detailed requirement was recorded for this error. Inspect the command receipt and engine journal before retrying.';
}

export function marketRequirements(e){
 const m=e?.market;
 if(m?.policy!=='V51_RANGE_PREFLIGHT_20261016'||!['atrM1','atrPoints','minAtr','maxAtr','adxM1','adxM5','adxM1Max3','adxM5Max3','adxLimit'].every(k=>typeof m[k]==='number'&&Number.isFinite(m[k])))return [];
 const n=v=>v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3});
 return [['ATR14 M1 · price / points',`${n(m.atrM1)} / ${n(m.atrPoints)} points`],['Allowed ATR · prior 1,440 M1 candles',`${n(m.minAtr)}–${n(m.maxAtr)} · P20–P60`],['ADX14 M1 · current / last 3 maximum',`${n(m.adxM1)} / ${n(m.adxM1Max3)}`],['ADX14 M5 · current / last 3 maximum',`${n(m.adxM5)} / ${n(m.adxM5Max3)}`],['Required ADX · both timeframes',`< ${n(m.adxLimit)} for 3 completed candles`]];
}
