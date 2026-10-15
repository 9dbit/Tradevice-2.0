import test from 'node:test';
import assert from 'node:assert/strict';
import {basketEstimate} from '../lib/basket-estimate.mjs';
const now=1792050000000;
const fixture=()=>({status:'ENGINE_REPORTED',observedMs:now,cycleId:'cycle-one',state:'ACTIVE',hardLossUsd:-120,targetUsd:3.5,
 riskExitCommitted:false,brokerFlatReconciled:false,entrySuspended:false,
 pnl:{value:-12.34,atMs:now,tickMs:now,basis:'ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED'},
 authorization:'NONE',authorizationExpiresMs:null,orderDispatchAuthorized:false});
test('estimate remains visible when expired, with original age and no fresh claim',()=>{
 const first=basketEstimate(null,fixture(),now,true);
 assert.equal(first.value,-12.34);assert.equal(first.fresh,true);
 for(const raw of [fixture(),null,{status:'ENGINE_REPORT_STALE',orderDispatchAuthorized:false}]){
  const stale=basketEstimate(first,raw,now+9000,false);
  assert.equal(stale.value,-12.34);assert.equal(stale.atMs,now);assert.equal(stale.fresh,false);
 }
 assert.equal(basketEstimate(null,null,now,false),null);
});
test('new sample updates; missing pnl and older samples cannot relabel cached value as current',()=>{
 const f=fixture(),first=basketEstimate(null,f,now,true);
 assert.equal(basketEstimate(first,{...f,pnl:null},now+1000,true).fresh,false);
 const next={...f,observedMs:now+1000,pnl:{...f.pnl,value:-10,atMs:now+1000,tickMs:now+1000}};
 const current=basketEstimate(first,next,now+1000,true);
 assert.equal(current.value,-10);
 assert.equal(basketEstimate(current,f,now+1000,true).value,-10);
 assert.equal(basketEstimate(current,f,now+1000,true).fresh,false);
});
test('cycle changes, completion, invalid data and dispatch authority clear old estimate',()=>{
 const f=fixture(),first=basketEstimate(null,f,now,true);
 for(const raw of [{...f,cycleId:'cycle-two',pnl:null},{...f,state:'COMPLETE_TP'},
  {...f,hardLossUsd:-999},{...f,orderDispatchAuthorized:true}])assert.equal(basketEstimate(first,raw,now,true),null);
 assert.equal(basketEstimate(first,{...f,cycleId:'cycle-two',pnl:{...f.pnl,value:0}},now,true).value,0);
});
