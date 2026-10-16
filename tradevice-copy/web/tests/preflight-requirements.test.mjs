import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsLabel,settingsMatch,selectedPreflightChecked,marginRequirements,failureRequirement} from '../lib/preflight-requirements.mjs';
const settings={protocol:'V51_DYNAMIC_ATR_USD_20261015',baseLot:.01,tpMode:'FIXED_3_5',customTpUsd:null};
test('selected configuration and timestamp must both match',()=>{
 const runtime={preflightEvidence:{settings,observedMs:10000}};
 assert.equal(selectedPreflightChecked(runtime,settings,11000),true);
 for(const change of [{baseLot:.1},{tpMode:'ATR_2'},{protocol:'old'},{customTpUsd:4}])assert.equal(settingsMatch(settings,{...settings,...change}),false);
 assert.equal(selectedPreflightChecked(runtime,settings,18001),false);
 assert.equal(selectedPreflightChecked(runtime,settings,9999),false);
 assert.equal(selectedPreflightChecked({},settings,10000),false);
});
test('requirements preserve broker numbers and round minima upward',()=>{
 const e={margin:{currency:'USD',freeMargin:2000,usedMargin:100,exposureMargin:6041.381,reserve:265,requiredFreeMargin:6306.381,minimumEquity:6406.381,shortfall:4306.381}};
 const rows=Object.fromEntries(marginRequirements(e));
 assert.equal(rows['Minimum equity at this exposure'],'$6,406.39');
 assert.equal(rows['Required free margin'],'$6,306.39');
 assert.equal(rows['Available free margin'],'$2,000.00');
 assert.equal(rows['Shortfall at check'],'$4,306.39');
 assert.deepEqual(marginRequirements(null),[]);
 assert.deepEqual(marginRequirements({margin:{...e.margin,freeMargin:NaN}}),[]);
});
test('shortfall differs from missing evidence and legacy rejection',()=>{
 assert.match(failureRequirement('MARGIN_ENVELOPE_INSUFFICIENT'),/Reduce the selected base lot/);
 assert.match(failureRequirement('MARGIN_ENVELOPE_UNVERIFIED'),/shortfall cannot be assumed/);
 assert.match(failureRequirement('PREFLIGHT_FAILED'),/historical requirement is unavailable/);
 assert.match(failureRequirement('SKILL_START_ENGINE_OFFLINE_OR_STALE'),/Restore the bridge/);
 assert.match(failureRequirement('PRIOR_CYCLE_RECONCILIATION_REQUIRED'),/Reset cannot clear/);
});

test('ATR/ADX requirements show numeric limits without confusing ATR with USD TP',async()=>{
 const {marketRequirements}=await import('../lib/preflight-requirements.mjs');
 const m={policy:'V51_RANGE_PREFLIGHT_20261016',atrM1:1.211,atrPoints:1211,minAtr:1.2,maxAtr:1.66,adxM1:35.56,adxM5:24.65,adxM1Max3:36,adxM5Max3:25,adxLimit:20};
 const rows=Object.fromEntries(marketRequirements({market:m}));
 assert.equal(rows['ATR14 M1 · price / points'],'1.211 / 1,211.00 points');
 assert.match(rows['Required ADX · both timeframes'],/< 20.00/);
 assert.deepEqual(marketRequirements({market:{...m,adxM1:NaN}}),[]);
 assert.match(failureRequirement('ATR_OUTSIDE_RANGE'),/not the basket TP/);
 assert.match(failureRequirement('ADX_TREND_NOT_RANGING'),/three completed candles/);
 assert.match(failureRequirement('MARKET_DATA_STALE'),/Reset cannot bypass/);
});

test('points amount is part of the checked configuration identity',()=>{
 const a={...settings,tpMode:'POINTS',tpPoints:4200};
 assert.equal(settingsMatch(a,{...a,tpPoints:1000}),false);
 assert.equal(settingsMatch(a,{...a}),true);
 assert.match(settingsLabel(a),/4,200 points/);
});
