import test from 'node:test';
import assert from 'node:assert/strict';
import {commandMessage,engineStatus,automaticMessage} from '../lib/demo-presentation.mjs';
const stopped={state:'STOPPED',automatic:{enabled:false,completedCycles:0,cycleRequestId:null}};
const request={action:'STOP',phase:'APPLIED',mode:'AUTOMATIC'};
test('confirmed Stop reports off, never waiting for preflight',()=>{
 assert.equal(commandMessage(request,stopped,true),'Stop confirmed · Automatic off. Engine stopped.');
 assert.doesNotMatch(commandMessage(request,stopped,true),/wait/i);
 assert.equal(engineStatus({...stopped,canStart:true},true,true),'Stopped');
 assert.match(automaticMessage(stopped,true),/^Automatic off/);
});
test('Stop receipt alone cannot claim stopped while basket is still supervised',()=>{
 assert.match(commandMessage(request,{...stopped,state:'STOPPING'},true),/Waiting for the engine to stop/);
 assert.doesNotMatch(commandMessage(request,{...stopped,state:'STOPPING'},true),/Engine stopped/);
});
test('stale and unavailable telemetry never confirm current stop or activation',()=>{
 assert.match(commandMessage(request,stopped,false),/completion is not verified/);
 assert.match(automaticMessage({automatic:{enabled:true}},false),/state unavailable/);
 assert.equal(engineStatus(stopped,false,true),'State unavailable');
});
test('Pause and Start receipts have distinct meanings independent of mode selection',()=>{
 assert.equal(commandMessage({...request,action:'PAUSE'},{...stopped,state:'PAUSED'},true),'Pause confirmed · Automatic off.');
 assert.match(commandMessage({...request,action:'START'},stopped,true),/currently off/);
 assert.match(commandMessage({...request,action:'START'},{state:'AUTO_WAITING',automatic:{enabled:true}},true),/waiting for all entry checks/);
 assert.doesNotMatch(commandMessage({...request,action:'START',mode:'CUSTOM'},stopped,true),/Automatic enabled/);
});
test('waiting is not an open basket and counts are scoped to this activation',()=>{
 const waiting={state:'AUTO_WAITING',automatic:{enabled:true,completedCycles:0}};
 assert.equal(engineStatus(waiting,true,true),'Automatic · waiting');
 assert.match(automaticMessage(waiting,true),/0 cycles completed in this activation/);
 assert.doesNotMatch(automaticMessage(waiting,true),/basket.*open/i);
});
test('unconfirmed and rejected commands never read as success',()=>{
 assert.match(commandMessage({...request,phase:'SENDING'},stopped,true),/Awaiting engine confirmation/);
 assert.match(commandMessage({...request,phase:'UNCERTAIN'},stopped,true),/Not confirmed/);
 assert.equal(commandMessage({...request,phase:'REJECTED',error:'SKILL_ENGINE_BLOCKED'},stopped,true),'SKILL_ENGINE_BLOCKED');
});

test('validation lock distinguishes Automatic from off or waiting',()=>{
 const locked={...stopped,validation:{protocol:'V51_VALIDATION_LOCK_20261017',status:'LOCKED_VALIDATION_PENDING',automaticAllowed:false,maxCustomCycles:1}};
 assert.match(automaticMessage(locked,true),/Automatic locked pending broker UAT/);
 assert.doesNotMatch(automaticMessage(locked,true),/Enable Automatic/);
});
