import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflightVerified as check} from '../lib/preflight-status.mjs';
const ready={canStart:true,state:'READY',blockers:[],checks:{quote:true,reconciled:true}};
test('stale evidence never receives check marks',()=>{for(const k of ['quote','reconciled','engineReady'])assert.equal(check(ready,false,k),false)});
test('recovery overrides cached reconciliation and engine readiness',()=>{const r={...ready,canStart:false,state:'RECOVERY_REQUIRED',blockers:['ENGINE_RECOVERY_REQUIRED']};assert.equal(check(r,true,'reconciled'),false);assert.equal(check(r,true,'engineReady'),false);assert.equal(check(r,true,'quote'),true)});
test('unknown blocker keeps engine unverified',()=>assert.equal(check({...ready,blockers:['UNKNOWN_GUARD']},true,'engineReady'),false));
test('fresh ready evidence passes',()=>assert.equal(check(ready,true,'engineReady'),true));

import {preflightDeferred,preflightStatus,preflightBlockers} from '../lib/preflight-status.mjs';
const running={...ready,state:'RUNNING',canStart:false,checks:{quote:false,reconciled:false},blockers:['ENGINE_NOT_READY','PREFLIGHT_QUOTE','PREFLIGHT_RECONCILED']};
test('active batch defers new-start checks, including old positive cache, without authorization',()=>{
 for(const state of ['STARTING','RUNNING','PAUSING','STOPPING']){
  const r={...running,state};
  assert.equal(preflightDeferred(r,true),true);
  for(const key of ['quote','reconciled','engineReady'])assert.equal(preflightStatus(r,true,key),'Deferred');
  assert.equal(check({...r,checks:{quote:true}},true,'quote'),false);
  assert.equal(r.canStart,false);
 }
});
test('active batch hides only derived new-start blockers and retains real safety evidence',()=>{
 const r={...running,blockers:[...running.blockers,'PREFLIGHT_NEWS','NEWS_NOT_CLEAR','ENGINE_FINGERPRINT_MISMATCH','MANUAL_KILL_OR_SAFETY_UNAVAILABLE','COMMAND_UNCONFIRMED','PREFLIGHT_UNAVAILABLE','UNKNOWN_GUARD']};
 assert.deepEqual(preflightBlockers(r,true),r.blockers.slice(4));
 assert.equal(r.blockers.length,10);
});
test('stale running data cannot imply deferred active health or verified checks',()=>{
 assert.equal(preflightDeferred(running,false),false);
 assert.equal(preflightStatus(running,false,'quote'),'Stale');
 assert.deepEqual(preflightBlockers(running,false),running.blockers);
});
test('recovery overrides active context, and paused/stopped batches need fresh preflight',()=>{
 const recovery={...running,blockers:['ENGINE_RECOVERY_REQUIRED']};
 assert.equal(preflightDeferred(recovery,true),false);
 assert.equal(preflightStatus(recovery,true,'reconciled'),'Blocked');
 for(const state of ['PAUSED','STOPPED','READY','RECOVERY_REQUIRED']){
  assert.equal(preflightDeferred({...running,state},true),false);
  assert.equal(preflightStatus({...running,state},true,'quote'),'Blocked');
 }
 assert.equal(preflightStatus(null,false,'quote'),'Unavailable');
 assert.equal(preflightStatus({...ready,checks:{}},true,'quote'),'Unavailable');
 assert.equal(preflightStatus(ready,true,'quote'),'Verified');
});
test('real news and fingerprint failures remain blocked even during active-batch deferral',()=>{
 const r={...running,checks:{news:true,engineHash:true},blockers:['NEWS_NOT_CLEAR','ENGINE_FINGERPRINT_MISMATCH']};
 for(const key of ['news','engineHash']){
  assert.equal(preflightStatus(r,true,key),'Blocked');
  assert.equal(check(r,true,key),false);
 }
});
