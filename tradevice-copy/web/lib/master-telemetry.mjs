/** Fail-closed projection for server-to-server staging master telemetry. No synthetic fallback. */
import {validateEngine,validateOwned} from './engine-diagnostics.mjs';
import {validateBatch} from './demo-batch.mjs';
import {validateNews} from './news-calendar.mjs';
const allowedModes=new Set(['ACTIVE','DEGRADED','RECOVERING','HALTED','OFFLINE/STALE']);
const allowedSeverities=new Set(['info','warning','critical']);
const allowedRunStatuses=new Set(['STOPPED','RUNNING','COMPLETED','HALTED']);
const allowedCycleModes=new Set(['CUSTOM','CONTINUOUS']);
const allowedNewsPolicies=new Set(['AVOID','ALLOW','ONLY']);
const allowedCommandStatuses=new Set(['PENDING','APPLIED','REJECTED']);
const commandRequestPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function count(x){return Number.isSafeInteger(x)&&x>=0&&x<=1e12?x:0}
function dateOrNull(s){return typeof s==='string'&&Number.isFinite(Date.parse(s))?s:null}
function metric(x,low=-Infinity){return typeof x==='number'&&Number.isFinite(x)&&x>=low?x:null}
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
    id:bounded(String(c.id??''),80),
    requestId:typeof c.requestId==='string'&&commandRequestPattern.test(c.requestId)?c.requestId:null,
    action:bounded(c.action,32),
    status:allowedCommandStatuses.has(c.status)?c.status:'UNKNOWN',
    errorCode:bounded(c.errorCode,100)||null,at:dateOrNull(c.at),
  })):[];
  const queue=raw.queue&&typeof raw.queue==='object'?raw.queue:{};

  const paper=raw.paperExecution&&typeof raw.paperExecution==='object'?raw.paperExecution:{};
  // Read-only operator display only. Server-side HMAC validator and volatile
  // expiry enforce provenance before this browser-facing projection runs.
  const m=raw.market&&typeof raw.market==='object'?raw.market:{};
  const mt=Date.parse(m.observedAt);
  const observed= m.status==='OBSERVED_READ_ONLY'&&m.source==='SIGNED_MT5_STAGING_READ_ONLY'&&
    m.accountMode==='DEMO'&&m.symbol==='XAUUSDm'&&
    m.executionAdapter==='INTERNAL_PAPER_ONLY'&&m.trustedForTradeAdmission===false&&
    Number.isFinite(mt)&&now-mt>=-1000&&now-mt<=8000&&
    typeof m.bid==='number'&&Number.isFinite(m.bid)&&m.bid>0&&
    typeof m.ask==='number'&&Number.isFinite(m.ask)&&m.ask>=m.bid&&
    typeof m.spreadPoints==='number'&&Number.isFinite(m.spreadPoints)&&
    m.spreadPoints>=0&&m.spreadPoints<=200000&&
    typeof m.atr14==='number'&&Number.isFinite(m.atr14)&&m.atr14>0&&
    typeof m.volatilityPct==='number'&&Number.isFinite(m.volatilityPct)&&
    m.volatilityPct>=0&&m.volatilityPct<=100;
  const market=observed?{
      demoBatch:validateBatch(m.demoBatch,now),engineDiagnostics:validateEngine(m.engineDiagnostics,now),ownedPositionPnl:validateOwned(m.ownedPositionPnl),
      status:'OBSERVED_READ_ONLY',source:'SIGNED_MT5_STAGING_READ_ONLY',
      brokerName:bounded(m.brokerName,70)||'Exness',accountMode:'DEMO',symbol:'XAUUSDm',
      observedAt:new Date(mt).toISOString(),bid:m.bid,ask:m.ask,
      pointSize:typeof m.pointSize==='number'&&m.pointSize>0?m.pointSize:null,
      spreadPoints:m.spreadPoints,commissionUsdPerLot:null,slippagePoints:null,
      volatilityPct:m.volatilityPct,volatilityWindow:'ATR14 / last M1 close',
      atr14:m.atr14,atrTimeframe:'M1',executionAdapter:'INTERNAL_PAPER_ONLY',
      atrRecomputed:m.atrRecomputed===true,
      accountCurrency:typeof m.accountCurrency==='string'&&/^[A-Z]{3,8}$/.test(m.accountCurrency)?m.accountCurrency:null,
      equity:metric(m.equity),margin:metric(m.margin,0),freeMargin:metric(m.freeMargin),
      marginLevelPct:m.margin===0?null:metric(m.marginLevelPct,0),
      positionsCount:Number.isSafeInteger(m.positionsCount)&&m.positionsCount>=0?m.positionsCount:null,
      pendingOrdersCount:Number.isSafeInteger(m.pendingOrdersCount)&&m.pendingOrdersCount>=0?m.pendingOrdersCount:null,
      foreignExposure:typeof m.foreignExposure==='boolean'?m.foreignExposure:null
    }:{
      demoBatch:null,engineDiagnostics:validateEngine(null,now),ownedPositionPnl:null,
      status:'NOT_CONNECTED',source:'NONE',brokerName:null,accountMode:null,
      symbol:null,observedAt:null,bid:null,ask:null,pointSize:null,
      spreadPoints:null,commissionUsdPerLot:null,slippagePoints:null,
      volatilityPct:null,volatilityWindow:null,atr14:null,atrTimeframe:null,
      executionAdapter:'INTERNAL_PAPER_ONLY',atrRecomputed:false,
      accountCurrency:null,equity:null,margin:null,freeMargin:null,marginLevelPct:null,
      positionsCount:null,pendingOrdersCount:null,foreignExposure:null,
    };
  return {
    source:'STAGING_WORKER_TELEMETRY',observedAt:new Date(ts).toISOString(),
    demoBatch:validateBatch(raw.demoBatch??(m.source==='SIGNED_MT5_STAGING_READ_ONLY'?m.demoBatch:null),now),
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
    market,news:validateNews(raw.news,now),
    control:{runStatus,cycleMode,targetCycles,strategyCycles,newsPolicy,
      sessionId:bounded(control.sessionId,80)||null,lastRejection:bounded(control.lastRejection,100)||null,
      operatorConfigured:control.operatorConfigured===true,
      // Read-only observer is never a trusted executable quote adapter.
      quotesReady:false,brokerReady:false,newsCalendarReady:false},
    terminal,commands,
    queue:{queued:count(queue.queued),retry:count(queue.retry),expired:count(queue.expired),
      rejected:count(queue.rejected),accepted:count(queue.accepted),deadLetter:count(queue.deadLetter)},
    paperExecution:{accepted:count(paper.accepted),rejected:count(paper.rejected),fillsVerified:false},
    equityCurve:[],
  };
}
