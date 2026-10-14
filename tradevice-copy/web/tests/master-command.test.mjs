import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorkerTelemetry} from '../lib/master-telemetry.mjs';

const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const consolePage=read('app/master/master-console.tsx');
const dashboard=read('app/master/compact-dashboard.tsx');
const route=read('app/api/master/command/route.ts');
const demo=read('app/master/demo-control.tsx');
const workerContract=read('app/api/master/overview/route.ts');
const masterCSS=read('app/master/master.css');
const now=Date.parse('2026-10-12T05:00:00Z');

test('Dashboard has five destinations with Risk and Paper in System',()=>{
  assert.match(consolePage,/key:'dashboard',label:'Dashboard'/);
  for(const k of ['overview','cycles','anomalies','system']) {
    assert.match(consolePage,new RegExp("key:'"+k+"'"));
  }
  assert.match(consolePage,/CompactDashboard/);
  assert.match(masterCSS,/MASTER_UNIFIED_COMMAND_DASHBOARD_V1/);
  assert.doesNotMatch(consolePage,/key:'(?:risk|journal)'/);
  assert.match(consolePage,/tab==='system'&&<section className="mt-panel"><SectionHead eyebrow="PAPER EXECUTION AUDIT"/);
});
test('Dashboard presents demo controls first and preserves six factual summaries',()=>{
 for(const t of ['Overview','Cycle Monitor','System Health','Risk & Safety','Anomaly Center','Paper Journal','Terminal Activity'])assert.ok(dashboard.includes(t),t);
 assert.ok(dashboard.indexOf('<DemoControl')<dashboard.indexOf('<div className="mt-u-grid">'));
 for(const t of ['Start Cycle','>Pause<','>Stop<'])assert.ok(demo.includes(t));
 assert.doesNotMatch(dashboard,/mt-u-statusline|Save Configuration|Reset Journal|SIM-001|Math\.random\(/);
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


test('demo start is finite and authorized by explicit Start click',()=>{
 assert.match(demo,/target<1\|\|target>10/);
 assert.match(demo,/confirmDemo:action==='START'/);
 assert.doesNotMatch(demo,/Saya mengizinkan|type="checkbox"/);
 assert.match(demo,/onClick=\{\(\)=>void send\('START'\)\}/);
 assert.match(demo,/!runtime\?\.canStart/);
 assert.match(dashboard,/mt-u-diagnostic/);
});
test('broker quality panel exists and never fabricates broker metrics or starts trading',()=>{
 for(const field of ['Broker & Market Conditions','Current Spread','Commission','Slippage',
  'Volatility','ATR (14)','MT5 Observer','Last quote','executionAdapter']) {
    assert.ok(dashboard.includes(field),field);
 }
 assert.match(dashboard,/Not connected/);
 assert.match(demo,/!runtime\?\.canStart/);
 assert.doesNotMatch(dashboard,/FAKE_BROKER|spreadPoints:\s*10|atr14:\s*5|commissionUsdPerLot:\s*5/);
});

test('master command origin is pinned to public staging host, not Railway request.url or forwarded host',()=>{
 assert.match(route,/masterCommandOriginAllowed\(request\.headers\.get\('origin'\)\)/);
 assert.doesNotMatch(route,/new URL\(request\.url\)\.origin/);
 assert.doesNotMatch(route,/x-forwarded-host|x-forwarded-proto/);
 assert.match(route,/MASTER_ORIGIN_MISMATCH/);
 assert.match(route,/masterAuthAllowed\(user\)/);
 assert.match(route,/parseMasterBearer/);
});


test('verified dashboard stays mounted during command save revalidation and JWT refresh',()=>{
 const source=consolePage;
 assert.match(source,/setAuth\(current=>current==='authorized'\?current:'checking'\)/);
 assert.doesNotMatch(source,/\n    setAuth\('checking'\);void load\(\);/);
 assert.match(source,/setAuth\(current=>current==='authorized'\?current:'forbidden'\)/);
 assert.match(source,/setSnapshot\(null\);\s*setAuth\(current=>current==='authorized'/);
 // Authorization failures, unlike transient telemetry outages, still revoke the session.
 assert.match(source,/response\.status===401\)\{setAuth\('login'\);setSnapshot\(null\)/);
 assert.match(source,/response\.status===403\)\{setAuth\('forbidden'\);setSnapshot\(null\)/);
 assert.match(source,/auth!=='authorized'/);
});


test('demo progress correlates exact engine receipts and never assumes HTTP acceptance is completion',()=>{
 assert.match(demo,/c.requestId===request.id/);
 assert.match(demo,/d.requestId!==id/);
 assert.match(demo,/phase:'UNCERTAIN'/);
 assert.doesNotMatch(demo,/setTimeout\([^;]*phase:'APPLIED'/s);
 assert.match(demo,/setInterval\(\(\)=>void refresh\(\),1000\)/);
});
test('demo start requires fresh independent engine evidence, not paper or observer flags',()=>{
 assert.match(demo,/evidenceNow-runtime.observedMs<=8000/);
 assert.match(demo,/!runtime\?\.canStart/);
 for(const gate of ['identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash'])assert.ok(demo.includes(gate));
 assert.doesNotMatch(demo,/brokerReady:\s*true|newsCalendarReady:\s*true/);
});
