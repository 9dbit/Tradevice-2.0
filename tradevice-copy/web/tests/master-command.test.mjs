import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorkerTelemetry} from '../lib/master-telemetry.mjs';

const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const consolePage=read('app/master/master-console.tsx');
const dashboard=read('app/master/compact-dashboard.tsx');
const route=read('app/api/master/command/route.ts');
const workerContract=read('app/api/master/overview/route.ts');
const masterCSS=read('app/master/master.css');
const now=Date.parse('2026-10-12T05:00:00Z');

test('Dashboard is first tab and other six pages remain',()=>{
  assert.match(consolePage,/key:'dashboard',label:'Dashboard'/);
  for(const k of ['overview','cycles','anomalies','risk','journal','system']) {
    assert.match(consolePage,new RegExp("key:'"+k+"'"));
  }
  assert.match(consolePage,/CompactDashboard/);
  assert.match(masterCSS,/MASTER_UNIFIED_COMMAND_DASHBOARD_V1/);
  assert.match(masterCSS,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(masterCSS,/\.mt-mobile-nav\[data-active="system"\]\{--mt-nav-index:6\}/);
});
test('six live data cards, controls and terminal are present without fixtures',()=>{
  for(const t of ['Overview','Cycle Monitor','System Health','Risk & Safety','Anomaly Center',
    'Paper Journal','Terminal Activity','Start Cycle','Stop Cycle','Save Configuration',
    'Reset Journal','Timestamp','Continuous','Custom','News Trading Policy']) {
    assert.ok(dashboard.includes(t),t);
  }
  assert.doesNotMatch(dashboard,/SIM-001|SIM-2008|EV-009|demoData|Math\.random\(/);
  assert.match(dashboard,/crypto\.randomUUID\(\)/);
  assert.match(dashboard,/confirmText!=='RESET'/);
  assert.match(dashboard,/!engineReady/);
});
test('command route authorizes real app_metadata user and never proxies member orders',()=>{
  assert.match(route,/masterAuthAllowed\(user\)/);
  assert.match(route,/parseMasterBearer/);
  assert.match(route,/MASTER_STAGING_ONLY/);
  assert.match(route,/MASTER_RESET_CONFIRM_REQUIRED/);
  assert.match(route,/MASTER_ADMIN_REQUIRED/);
  assert.match(route,/internal\/master\/command/);
  assert.doesNotMatch(route,/\/api\/v1\/paper\/orders|service_role|NEXT_PUBLIC_MASTER/);
  assert.match(workerContract,/MASTER_TELEMETRY_SHARED_SECRET/);
});
test('telemetry accepts only verified operator event metadata and no fake fills',()=>{
 const raw={source:'STAGING_WORKER_TELEMETRY',environment:'staging',executionMode:'PAPER_ONLY',
 observedAt:'2026-10-12T05:00:00Z',
 master:{id:'tradevice-master-staging',state:'DEGRADED',heartbeatAt:'2026-10-12T04:59:59Z',
  cycles:3,activeSource:null},
 infrastructure:{masterWorker:'ONLINE',journal:'CONNECTED',adminAuth:'VERIFIED'},
 risk:{killSwitch:'DISENGAGED'},
 activity:[],paperOrders:[],equityCurve:[1000,2000],
 control:{runStatus:'STOPPED',cycleMode:'CUSTOM',targetCycles:100,strategyCycles:0,
  newsPolicy:'AVOID',sessionId:'test',operatorConfigured:true,
  quotesReady:false,brokerReady:true,newsCalendarReady:true},
 terminal:[{id:'1',at:'2026-10-12T04:59:59Z',source:'CONTROL',
  severity:'warning',kind:'COMMAND_REJECTED',message:'TRUSTED_MARKET_AND_PAPER_BROKER_NOT_READY'}],
 commands:[{id:'c',action:'START',status:'REJECTED',errorCode:'NO_FEED',at:'2026-10-12T04:59:59Z'}],
 };
 const v=validateWorkerTelemetry(raw,now);
 assert.equal(v.control.runStatus,'STOPPED');
 assert.equal(v.control.cycleMode,'CUSTOM');
 assert.equal(v.control.targetCycles,100);
 assert.equal(v.control.operatorConfigured,true);
 assert.equal(v.control.brokerReady,false);
 assert.equal(v.control.newsCalendarReady,false);
 assert.equal(v.terminal.length,1);
 assert.equal(v.commands.length,1);
 assert.equal(v.risk.pnlUsd,null);
 assert.deepEqual(v.equityCurve,[]);
});
