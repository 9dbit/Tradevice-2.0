import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsMatch,selectedPreflightChecked,marginRequirements,failureRequirement} from '../lib/preflight-requirements.mjs';
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
