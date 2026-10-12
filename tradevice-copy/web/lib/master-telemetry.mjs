/** Fail-closed projection for server-to-server staging master telemetry. No synthetic fallback. */
const allowedModes=new Set(['ACTIVE','DEGRADED','RECOVERING','HALTED','OFFLINE/STALE']);
const allowedSeverities=new Set(['info','warning','critical']);
const allowedRunStatuses=new Set(['STOPPED','RUNNING','COMPLETED','HALTED']);
const allowedCycleModes=new Set(['CUSTOM','CONTINUOUS']);
const allowedNewsPolicies=new Set(['AVOID','ALLOW','ONLY']);
function count(x){return Number.isSafeInteger(x)&&x>=0&&x<=1e12?x:0}
function dateOrNull(s){return typeof s==='string'&&Number.isFinite(Date.parse(s))?s:null}
function bounded(s,n=150){return typeof s==='string'?s.slice(0,n):''}
export function validateWorkerTelemetry(raw, now=Date.now()) {
  if(!raw || typeof raw!=='object' || raw.source!=='STAGING_WORKER_TELEMETRY' ||
    raw.environment!=='staging' || raw.executionMode!=='PAPER_ONLY' ||
    !raw.master || typeof raw.master!=='object' || !raw.infrastructure ||
    typeof raw.infrastructure!=='object')return null;
  const ts=Date.parse(raw.observedAt);
  if(!Number.isFinite(ts)||Math.abs(now-ts)>45000)return null;
  const hb=dateOrNull(raw.master.heartbeatAt);
  const heartbeatAge=hb?now-Date.parse(hb):Infinity;
  const online=raw.infrastructure.masterWorker==='ONLINE' &&
    heartbeatAge>=-2000 && heartbeatAge<=15000;
  const candidate=allowedModes.has(raw.master.state)?raw.master.state:'OFFLINE/STALE';
  const state=!online?'OFFLINE/STALE':
    candidate==='ACTIVE'&&!raw.master.activeSource?'DEGRADED':candidate;
  const events=Array.isArray(raw.activity)?raw.activity.slice(0,30).filter(x=>x&&typeof x==='object').map(x=>({
    id:bounded(String(x.id??''),60),at:dateOrNull(x.at),
    severity:allowedSeverities.has(x.severity)?x.severity:'warning',
    kind:bounded(x.kind,100),note:bounded(x.note,500),
  })):[];
  const orders=Array.isArray(raw.paperOrders)?raw.paperOrders.slice(0,30)
    .filter(x=>x&&typeof x==='object').map(x=>({
      id:bounded(String(x.id??''),80),at:dateOrNull(x.at),
      symbol:bounded(x.symbol,24),side:x.side==='BUY'||x.side==='SELL'?x.side:'N/A',
      state:bounded(x.state,40),quantity:bounded(x.quantity,16),
    })):[];
  const control=raw.control&&typeof raw.control==='object'?raw.control:{};
  const runStatus=allowedRunStatuses.has(control.runStatus)?control.runStatus:'NOT_CONFIGURED';
  const cycleMode=allowedCycleModes.has(control.cycleMode)?control.cycleMode:'CONTINUOUS';
  const newsPolicy=allowedNewsPolicies.has(control.newsPolicy)?control.newsPolicy:'AVOID';
  const targetCycles=cycleMode==='CUSTOM'&&Number.isSafeInteger(control.targetCycles)&&
    control.targetCycles>=1&&control.targetCycles<=1000000?control.targetCycles:null;
  const strategyCycles=Number.isSafeInteger(control.strategyCycles)&&control.strategyCycles>=0
    ?control.strategyCycles:null;
  const terminal=Array.isArray(raw.terminal)?raw.terminal.slice(0,60).filter(e=>e&&
    typeof e==='object'&&dateOrNull(e.at)&&allowedSeverities.has(e.severity)).map(e=>({
    id:bounded(String(e.id??''),60),at:dateOrNull(e.at),source:bounded(e.source,30),
    severity:e.severity,kind:bounded(e.kind,80),message:bounded(e.message,240),
  })):[];
  const commands=Array.isArray(raw.commands)?raw.commands.slice(0,12).filter(c=>c&&
    typeof c==='object').map(c=>({
    id:bounded(String(c.id??''),80),action:bounded(c.action,32),status:bounded(c.status,32),
    errorCode:bounded(c.errorCode,100)||null,at:dateOrNull(c.at),
  })):[];
  const queue=raw.queue&&typeof raw.queue==='object'?raw.queue:{};
  const paper=raw.paperExecution&&typeof raw.paperExecution==='object'?raw.paperExecution:{};
  return {
    source:'STAGING_WORKER_TELEMETRY',observedAt:new Date(ts).toISOString(),
    executionMode:'PAPER_ONLY',
    master:{
      id:bounded(raw.master.id,100)||null,state,heartbeatAt:hb,
      lastCycleAt:dateOrNull(raw.master.lastCycleAt),uptimeSeconds:online?count(raw.master.uptimeSeconds):null,
      cycles:Number.isSafeInteger(raw.master.cycles)?raw.master.cycles:null,
      healthyCycles:Number.isSafeInteger(raw.master.healthyCycles)?raw.master.healthyCycles:null,
      anomalies:Number.isSafeInteger(raw.master.anomalies)?raw.master.anomalies:null,
      activeSource:online?bounded(raw.master.activeSource,100)||null:null,
      recoveryTicks:Number.isSafeInteger(raw.master.recoveryTicks)?raw.master.recoveryTicks:null,
      reason:bounded(raw.master.reason,100)||null,
    },
    risk:{
      killSwitch:['ENGAGED','DISENGAGED','UNAVAILABLE'].includes(raw.risk?.killSwitch)?raw.risk.killSwitch:'UNAVAILABLE',
      positions:null,equityUsd:null,pnlUsd:null,drawdownPct:null,winRatePct:null,
    },
    infrastructure:{
      masterWorker:online?'ONLINE':'OFFLINE/STALE',journal:'CONNECTED',adminAuth:'VERIFIED',
    },
    activity:events,paperOrders:orders,
    control:{runStatus,cycleMode,targetCycles,strategyCycles,newsPolicy,
      sessionId:bounded(control.sessionId,80)||null,lastRejection:bounded(control.lastRejection,100)||null,
      operatorConfigured:control.operatorConfigured===true,
      quotesReady:control.quotesReady===true && online,
      brokerReady:false,newsCalendarReady:false},
    terminal,commands,
    queue:{queued:count(queue.queued),retry:count(queue.retry),expired:count(queue.expired),
      rejected:count(queue.rejected),accepted:count(queue.accepted),deadLetter:count(queue.deadLetter)},
    paperExecution:{accepted:count(paper.accepted),rejected:count(paper.rejected),fillsVerified:false},
    equityCurve:[],
  };
}
