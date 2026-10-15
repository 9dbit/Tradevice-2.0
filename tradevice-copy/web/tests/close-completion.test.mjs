import test from 'node:test';
import assert from 'node:assert/strict';
import {closeCompleted} from '../lib/close-completion.mjs';
const now=1800000000000;
const receipt={requestId:'close-1',action:'EMERGENCY_CLOSE',status:'APPLIED'};
function runtime(){return {online:true,observedMs:now,state:'RECOVERY_REQUIRED',canStart:false,checks:{brokerFlat:true,reconciled:false},commands:[receipt],emergencyClose:{requestId:'close-1',phase:'COMPLETE',observedMs:now-10000,positionsRemaining:0,ordersRemaining:0}};}
test('verified account closure permits UI reset without clearing recovery or authorizing Start',()=>{
 const r=runtime(),before=structuredClone(r);assert.equal(closeCompleted(r,now),true);assert.deepEqual(r,before);assert.equal(r.canStart,false);
});
test('completion requires matching APPLIED receipt, COMPLETE and explicit zero counts',()=>{
 for(const patch of [{phase:'VERIFYING_FLAT'},{requestId:'other'},{positionsRemaining:1},{ordersRemaining:1},{positionsRemaining:null},{ordersRemaining:null},{observedMs:now+1}]){
  const r=runtime();Object.assign(r.emergencyClose,patch);assert.equal(closeCompleted(r,now),false,JSON.stringify(patch));
 }
 for(const status of ['PENDING','DISPATCHED','UNCERTAIN','EXPIRED','REJECTED']){const r=runtime();r.commands=[{...receipt,status}];assert.equal(closeCompleted(r,now),false);}
 const r=runtime();r.commands=[];assert.equal(closeCompleted(r,now),false);
});
test('historical proof never hides emergency controls for an active or newer batch',()=>{
 for(const state of ['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'])assert.equal(closeCompleted({...runtime(),state},now),false);
 for(const action of ['START','EMERGENCY_CLOSE'])for(const status of ['PENDING','DISPATCHED','APPLIED','UNCERTAIN']){
  const r=runtime();r.commands.unshift({requestId:'new-request',action,status});assert.equal(closeCompleted(r,now),false);
 }
 const r=runtime();r.commands.unshift({requestId:'rejected-start',action:'START',status:'REJECTED'});assert.equal(closeCompleted(r,now),true);
});
test('stale offline missing or non-flat current evidence cannot suppress Close all',()=>{
 for(const patch of [{online:false},{observedMs:now-8001},{observedMs:now+1},{observedMs:null},{checks:{brokerFlat:false}},{checks:{}},{emergencyClose:null}])assert.equal(closeCompleted({...runtime(),...patch},now),false);
 assert.equal(closeCompleted(null,now),false);
});
