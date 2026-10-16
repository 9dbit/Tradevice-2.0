import {test} from 'node:test';
import assert from 'node:assert/strict';
import {showCloseControl} from '../lib/cycle-controls.mjs';
const options={fresh:true,closed:false};
test('reset and Automatic waiting with verified flat book have no close slider',()=>{
 for(const state of ['READY','STOPPED','AUTO_WAITING','RECOVERY_REQUIRED'])
  assert.equal(showCloseControl({state,checks:{brokerFlat:true}}, {...options,unfinished:1,lastActive:{state:'RUNNING'}}),false);
});
test('exposure and uncertain recovery retain close access; stale evidence cannot clear it',()=>{
 for(const state of ['READY','AUTO_WAITING','RECOVERY_REQUIRED'])
  assert.equal(showCloseControl({state,checks:{brokerFlat:false}},options),true);
 assert.equal(showCloseControl({state:'RECOVERY_REQUIRED',checks:{brokerFlat:true}},{...options,fresh:false}),true);
 assert.equal(showCloseControl({state:'OFFLINE'}, {...options,fresh:false,lastActive:{state:'RUNNING'}}),true);
 assert.equal(showCloseControl({state:'RUNNING',checks:{brokerFlat:true}},options),true);
 assert.equal(showCloseControl({state:'RECOVERY_REQUIRED'},{...options,closed:true}),false);
});

test('fresh observed exposure overrides a contradictory flat preflight',()=>{
 assert.equal(showCloseControl({state:'READY',checks:{brokerFlat:true}},{...options,brokerExposure:1}),true);
 assert.equal(showCloseControl({state:'AUTO_WAITING',checks:{brokerFlat:true}},{...options,brokerExposure:2}),true);
});
