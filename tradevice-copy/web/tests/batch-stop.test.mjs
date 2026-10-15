import test from 'node:test';import assert from 'node:assert/strict';
import {batchStopNotice} from '../lib/batch-stop.mjs';
const p={batchId:'test',status:'STOPPED',completed:3,total:10,unfinished:0,lastOutcome:'COMPLETE_BROKER_CLOSED',blockers:[]};
test('broker rejection and later TP reconciliation explain separate states',()=>{
 assert.match(batchStopNotice({...p,blockers:['BROKER_REJECT_10013'],unfinished:1},false).reason,/Invalid request/);
 const n=batchStopNotice({...p,blockers:['BROKER_TP_AFTER_SAFETY_STOP']},false);
 assert.match(n.reason,/will not resume/);assert.equal(n.resetSafe,true);
});
test('partial completed batch explains cleanup',()=>{const n=batchStopNotice(p,false);assert.match(n.reason,/terminal cleanup/);assert.equal(n.resetSafe,true)});
test('running and successfully completed batches do not alert',()=>{assert.equal(batchStopNotice(p,true),null);assert.equal(batchStopNotice({...p,completed:10},false),null)});
test('unreconciled batch cannot reset from modal',()=>assert.equal(batchStopNotice({...p,unfinished:1},false).resetSafe,false));
test('risk exit and news suspension retain their reason',()=>{assert.match(batchStopNotice({...p,lastOutcome:'COMPLETE_RISK_EXIT'},false).reason,/risk limit/);assert.match(batchStopNotice({...p,lastOutcome:'COMPLETE_NEWS_RETIRED'},false).reason,/News/)});
