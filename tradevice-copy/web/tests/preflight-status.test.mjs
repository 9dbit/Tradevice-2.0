import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflightVerified as check} from '../lib/preflight-status.mjs';
const ready={canStart:true,state:'READY',blockers:[],checks:{quote:true,reconciled:true}};
test('stale evidence never receives check marks',()=>{for(const k of ['quote','reconciled','engineReady'])assert.equal(check(ready,false,k),false)});
test('recovery overrides cached reconciliation and engine readiness',()=>{const r={...ready,canStart:false,state:'RECOVERY_REQUIRED',blockers:['ENGINE_RECOVERY_REQUIRED']};assert.equal(check(r,true,'reconciled'),false);assert.equal(check(r,true,'engineReady'),false);assert.equal(check(r,true,'quote'),true)});
test('unknown blocker keeps engine unverified',()=>assert.equal(check({...ready,blockers:['UNKNOWN_GUARD']},true,'engineReady'),false));
test('fresh ready evidence passes',()=>assert.equal(check(ready,true,'engineReady'),true));
