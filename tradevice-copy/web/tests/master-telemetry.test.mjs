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
