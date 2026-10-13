import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkerTelemetry} from '../lib/master-telemetry.mjs';
const now=Date.parse('2026-10-12T05:00:00Z');
const raw={
 source:'STAGING_WORKER_TELEMETRY',environment:'staging',executionMode:'PAPER_ONLY',
 observedAt:'2026-10-12T05:00:00Z',
 master:{id:'tradevice-master-staging',state:'DEGRADED',heartbeatAt:'2026-10-12T04:59:59Z',
 cycles:28,healthyCycles:0,anomalies:1,activeSource:null,recoveryTicks:0,killSwitch:false},
 infrastructure:{masterWorker:'ONLINE',journal:'CONNECTED',adminAuth:'VERIFIED'},
 risk:{killSwitch:'DISENGAGED',positions:null},
 activity:[],paperOrders:[],queue:{queued:2},paperExecution:{accepted:0,rejected:0},
 equityCurve:[],
};
test('real heartbeat retained, synthetic PnL erased',()=>{
 const x=validateWorkerTelemetry({...raw,risk:{...raw.risk,pnlUsd:999999},equityCurve:[1000,3000]},now);
 assert.equal(x.master.state,'DEGRADED');assert.equal(x.master.cycles,28);
 assert.equal(x.risk.pnlUsd,null);assert.deepEqual(x.equityCurve,[]);
 assert.equal(x.queue.queued,2);
});
test('stale heartbeat is offline even if source says ACTIVE',()=>{
 const x=validateWorkerTelemetry({...raw,master:{...raw.master,state:'ACTIVE',
 heartbeatAt:'2026-10-12T04:58:00Z'}},now);
 assert.equal(x.master.state,'OFFLINE/STALE');
 assert.equal(x.infrastructure.masterWorker,'OFFLINE/STALE');
});
test('no approved feed cannot mark ACTIVE',()=>{
 const x=validateWorkerTelemetry({...raw,master:{...raw.master,state:'ACTIVE'}},now);
 assert.equal(x.master.state,'DEGRADED');
});
test('invalid provider/source/time cannot fall back to synthetic',()=>{
 for(const x of [null,{}, {...raw,source:'SYNTHETIC_PREVIEW'},
 {...raw,executionMode:'LIVE'}, {...raw,observedAt:'2026-10-12T04:00:00Z'}]){
  assert.equal(validateWorkerTelemetry(x,now),null);
 }
});

test('untrusted broker values never appear when no signed staging observer exists',()=>{
 const poisoned={...raw,market:{status:'VERIFIED',source:'UNKNOWN',brokerName:'Synthetic Broker',
   spreadPoints:100,commissionUsdPerLot:123,slippagePoints:10,volatilityPct:9,atr14:500}};
 const x=validateWorkerTelemetry(poisoned,now);
 assert.equal(x.market.status,'NOT_CONNECTED');
 assert.equal(x.market.brokerName,null);
 assert.equal(x.market.spreadPoints,null);
 assert.equal(x.market.atr14,null);
 assert.equal(x.market.commissionUsdPerLot,null);
 assert.equal(x.market.slippagePoints,null);
});
test('verified operator command receipt can be correlated to requestId without revealing private metadata',()=>{
 const requestId='e0000000-0000-4000-8000-000000000001';
 const x=validateWorkerTelemetry({...raw,commands:[
   {id:'internal-id',requestId,action:'CONFIGURE',status:'APPLIED',
    errorCode:null,at:'2026-10-12T04:59:59Z'},
   {id:'internal-other',requestId:'not-an-id',action:'CONFIGURE',status:'FAKE_APPLIED'},
 ]},now);
 assert.equal(x.commands[0].requestId,requestId);
 assert.equal(x.commands[0].status,'APPLIED');
 assert.equal(x.commands[1].requestId,null);
 assert.equal(x.commands[1].status,'UNKNOWN');
});


test('signed staging demo observation is display-only and never unlocks START',()=>{
 const snapshot={...raw,market:{
   status:'OBSERVED_READ_ONLY',source:'SIGNED_MT5_STAGING_READ_ONLY',brokerName:'Exness',
   accountMode:'DEMO',symbol:'XAUUSDm',observedAt:'2026-10-12T04:59:59Z',
   bid:4200.01,ask:4200.25,spreadPoints:240,pointSize:0.001,
   atr14:1.501857,volatilityPct:0.035782,commissionUsdPerLot:99999,
   slippagePoints:99999,executionAdapter:'INTERNAL_PAPER_ONLY',
   trustedForTradeAdmission:false,
 },control:{runStatus:'STOPPED',quotesReady:true,brokerReady:true,newsCalendarReady:true}};
 const value=validateWorkerTelemetry(snapshot,now);
 assert.equal(value.market.status,'OBSERVED_READ_ONLY');
 assert.equal(value.market.spreadPoints,240);
 assert.equal(value.market.atr14,1.501857);
 assert.equal(value.market.commissionUsdPerLot,null);
 assert.equal(value.market.slippagePoints,null);
 assert.equal(value.control.quotesReady,false);
 assert.equal(value.control.brokerReady,false);
 assert.equal(value.control.newsCalendarReady,false);
});
test('spoofed or stale MT5 telemetry is suppressed',()=>{
 const market={status:'OBSERVED_READ_ONLY',source:'SIGNED_MT5_STAGING_READ_ONLY',
   accountMode:'DEMO',symbol:'XAUUSDm',executionAdapter:'INTERNAL_PAPER_ONLY',
   trustedForTradeAdmission:false,brokerName:'Exness',bid:4200.01,ask:4200.24,
   spreadPoints:230,atr14:1.5,volatilityPct:0.03,observedAt:'2026-10-12T04:59:59Z'};
 for(const mutation of [
   {source:'UNKNOWN'}, {trustedForTradeAdmission:true},
   {accountMode:'REAL'}, {symbol:'XAUUSD'}, {observedAt:'2026-10-12T04:58:00Z'},
   {ask:4180}, {atr14:NaN}, {spreadPoints:-1}
 ]){
   const result=validateWorkerTelemetry({...raw,market:{...market,...mutation}},now);
   assert.equal(result.market.status,'NOT_CONNECTED');
   assert.equal(result.market.bid,null);
 }
});
