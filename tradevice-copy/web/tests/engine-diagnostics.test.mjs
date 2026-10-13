import test from 'node:test';import assert from 'node:assert/strict';
import {validateEngine,validateOwned} from '../lib/engine-diagnostics.mjs';
const now=1791918000000;
const fixture=()=>({status:'ENGINE_REPORTED',observedMs:now,cycleId:'test-cycle',state:'ACTIVE',hardLossUsd:-120,targetUsd:3.5,
 riskExitCommitted:false,brokerFlatReconciled:false,entrySuspended:false,
 pnl:{value:-90,atMs:now,tickMs:now,basis:'ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED'},
 decision:{layer:6,candleCloseMs:now-5000,distance_points:1750,atr:2,body_atr:.3,body_range:.4,
 accepted:false,structuralReversal:false,reasons:['BODY_ATR_BELOW_050']},
 authorization:'AUTHORIZED',authorizationExpiresMs:now+1000,orderDispatchAuthorized:false});
test('valid engine report stays display only',()=>{const x=validateEngine(fixture(),now);assert.equal(x.pnl.value,-90);assert.equal(x.orderDispatchAuthorized,false)});
test('browser timer expires engine, P&L, decisions and auth independently',()=>{
 const f=fixture();assert.equal(validateEngine(f,now+1000).authorization,'EXPIRED');
 assert.equal(validateEngine(f,now+5001).pnl,null);assert.equal(validateEngine(f,now+8001).decision,null);
 f.observedMs=now+130000;assert.equal(validateEngine(f,now+130000).decision,null);
});
test('wrong limits and false reconciliation refused',()=>{for(const [k,v] of [['hardLossUsd',-200],['brokerFlatReconciled',true],['orderDispatchAuthorized',true]]){
 const f=fixture();f[k]=v;assert.equal(validateEngine(f,now).pnl,null)}});
test('nonfinite and future values refused',()=>{const f=fixture();f.pnl.value=NaN;assert.equal(validateEngine(f,now).pnl,null);assert.equal(validateEngine(fixture(),now-1).pnl,null)});
test('empty report does not fabricate zero profit or protection',()=>{const e=validateEngine(null,now);assert.equal(e.hardLossUsd,null);assert.equal(e.brokerFlatReconciled,null)});
test('owned aggregate never means cycle net',()=>{const p={basis:'MAGIC_SYMBOL_OPEN_PROFIT_PLUS_SWAP',netCyclePnlVerified:false,currency:'USD',value:-12,positions:2,pending:0};assert.equal(validateOwned(p).value,-12);assert.equal(validateOwned({...p,netCyclePnlVerified:true}),null);assert.equal(validateOwned({...p,positions:0}),null)});
