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


test('operator save can reapply the unchanged Continuous and Avoid News policy',()=>{
 const saveControl=dashboard.match(/<button className="mt-u-apply"[\s\S]*?<\/button>/)?.[0]||'';
 assert.match(saveControl,/Save Configuration/);
 assert.match(saveControl,/onClick=\{\(\)=>void command\('CONFIGURE'\)\}/);
 assert.doesNotMatch(saveControl,/!dirty/);
 assert.match(dashboard,/Save Configuration · Reapply/);
 assert.match(dashboard,/mt-u-diagnostic/);
 assert.match(workerContract,/MASTER_READ_DB_ACCESS_FAILED/);
});

test('broker quality panel exists and never fabricates broker metrics or starts trading',()=>{
 for(const field of ['Broker & Market Conditions','Current Spread','Commission','Slippage',
  'Volatility','ATR (14)','MT5 Observer','Last quote','executionAdapter']) {
    assert.ok(dashboard.includes(field),field);
 }
 assert.match(dashboard,/Not connected/);
 assert.match(dashboard,/!engineReady/);
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


test('submit progress does not pretend HTTP 202 means worker APPLIED',()=>{
 assert.match(dashboard,/type CommandPhase='SENDING'\|'QUEUED'\|'APPLIED'\|'REJECTED'\|'DELAYED'/);
 assert.match(dashboard,/receipt\?\.requestId!==requestId/);
 assert.match(dashboard,/command\.requestId===commandProgress\.requestId/);
 assert.match(dashboard,/row\.status==='APPLIED'/);
 assert.match(dashboard,/row\.status==='REJECTED'/);
 assert.match(dashboard,/role="progressbar"/);
 assert.match(dashboard,/mt-u-command-progress/);
 assert.match(dashboard,/aria-valuetext=\{progressText\}/);
 assert.match(dashboard,/setInterval\(\(\)=>onUpdatedRef\.current\(\),2500\)/);
 assert.match(dashboard,/phase:'DELAYED'/);
 assert.doesNotMatch(dashboard,/setTimeout\(\(\)=>\s*setCommandProgress\(.*phase:'APPLIED'/s);
 assert.match(masterCSS,/MASTER_COMMAND_RECEIPT_PROGRESS_V1/);
 assert.match(masterCSS,/@keyframes mt-u-progress-scan/);
 assert.match(masterCSS,/@media\(prefers-reduced-motion:reduce\)/);
});

test('start remains fail-closed and shows real feed / broker / news readiness',()=>{
 assert.match(dashboard,/control\?\.quotesReady===true/);
 assert.match(dashboard,/control\?\.brokerReady===true/);
 assert.match(dashboard,/control\?\.newsCalendarReady===true/);
 assert.match(dashboard,/data\?\.risk\.killSwitch==='DISENGAGED'/);
 assert.match(dashboard,/disabled=\{!canOperate\|\|!engineReady\|\|commandBusy\|\|/);
 assert.match(dashboard,/Persyaratan Start Trading demo/);
 assert.doesNotMatch(dashboard,/brokerReady:\s*true|newsCalendarReady:\s*true/);
});
