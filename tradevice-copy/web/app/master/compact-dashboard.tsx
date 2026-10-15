'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Snapshot} from './master-console';
import {validateEngine,validateOwned} from '../../lib/engine-diagnostics.mjs';
import {basketEstimate} from '../../lib/basket-estimate.mjs';
import type {BasketEstimate} from '../../lib/basket-estimate.mjs';
import {validateBatch} from '../../lib/demo-batch.mjs';
import {NewsStatus} from './news-status';
import GrowthChart from './growth-chart';
import TerminalMirror from './terminal-mirror';
import SkillManager from './skill-manager';
import DemoControl,{useDemoRuntime} from './demo-control';
import {validateNews} from '../../lib/news-calendar.mjs';
import {ReportSection,ReportIcon as I,ReportDrawer,TelemetryDatum as Datum} from './report-ui';

type Details='overview'|'cycles'|'anomalies'|'system';
function fmt(value:number|null|undefined,unit=''){
 return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2})+unit:'—';
}
function time(ts:string|null|undefined) {
 if(!ts || !Number.isFinite(Date.parse(ts)))return '—';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',
   second:'2-digit',day:'2-digit',month:'short',hour12:false}).format(new Date(ts))+' WIB';
}
export default function CompactDashboard({data,token,onNavigate}:{
 data:Snapshot|null;token:string;onNavigate:(tab:Details)=>void;
}){
 const {runtime:demoRuntime,refresh:refreshDemo}=useDemoRuntime(token);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
 const calendar=validateNews(data?.news,now);
 const observed=data?.market?.observedAt;
 const marketFresh=['OBSERVED_READ_ONLY','VERIFIED'].includes(data?.market?.status||'')&&observed!=null&&now-Date.parse(observed)>=0&&now-Date.parse(observed)<=8000;
 // Stale observations retain their timestamp, never their appearance as current values.
 const market=marketFresh?data?.market:null;
 // Display memory only: retained numbers never enter preflight or engine guards.
 // Polling failures and freshness expiry must not erase an already painted value.
 const lastMarket=useRef<Snapshot['market']>(undefined);
 useEffect(()=>{if(market)lastMarket.current=market;},[market]);
 const displayMarket=market??lastMarket.current;
 const marketLabel=market?'Fresh':displayMarket?'Last known · stale':'Unavailable';
 const engine=validateEngine(market?.engineDiagnostics,now);
 const owned=validateOwned(market?.ownedPositionPnl);
 const decision=engine.decision;
 const [lastEstimate,setLastEstimate]=useState<BasketEstimate|null>(null);
 const estimate=basketEstimate(lastEstimate,data?.market?.engineDiagnostics,now,marketFresh);
 useEffect(()=>{setLastEstimate(estimate);},[data?.market?.engineDiagnostics,now,marketFresh]);
 const batch=validateBatch(data?.demoBatch??data?.market?.demoBatch,now);
 const executedCycles=batch?batch.cycles.filter(c=>c.layers>0).length:null;
 const usd=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const newsTime=(value:number|null)=>value===null?'—':time(new Date(value).toISOString());
 const [terminalFilter,setTerminalFilter]=useState<'all'|'warning'|'critical'>('all');
 const terminal=useMemo(()=>(data?.terminal||[]).filter(e=>terminalFilter==='all'||
   e.severity===terminalFilter).slice().sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)),
 [data?.terminal,terminalFilter]);
 const diagnostic=data?.diagnostic?.code;

 return <div className="mt-unified mt-dense-dashboard">
  {diagnostic&&<div className="mt-u-diagnostic" role="alert"><I name="alert"/>
   <div><strong>Telemetry unavailable</strong><p>{diagnostic}</p></div></div>}
  <DemoControl token={token} runtime={demoRuntime} refresh={refreshDemo} now={now} batchRaw={data?.demoBatch??data?.market?.demoBatch} newsRaw={data?.news}/>

  <ReportSection title="Basket &amp; Adaptive" className="mt-u-panel" aria-labelledby="risk-title" header={<div className="mt-u-panel-head"><h2 id="risk-title"><I name="shield"/> Basket &amp; Adaptive</h2>
    <span className="mt-u-chip">{engine.entrySuspended===true?'Entry suspended':engine.status==='ENGINE_REPORTED'?engine.state||'Reported':'Unverified'}</span></div>}>

   <div className="mt-telemetry-grid">
    <Datum icon="activity" label="Basket estimate" value={usd(estimate?.value)} hint={estimate?`${estimate.fresh?'Reported':'Last known'} · ${Math.max(0,Math.floor((now-Math.min(estimate.atMs,estimate.tickMs))/1000))}s ago · costs unverified`:'Awaiting estimate'}/>
    <Datum icon="shield" label="Hard loss" value={usd(engine.hardLossUsd)} hint={engine.riskExitCommitted===true?'Exit committed':'engine report'}/>
    <Datum icon="check" label="Basket TP" value={engine.tpBasis==='ATR_PRICE_DISTANCE'?fmt(engine.tpDistancePoints,' pts'):usd(engine.targetUsd)} hint={engine.tpBasis==='ATR_PRICE_DISTANCE'?`${usd(engine.tpDistancePrice)} price move · weighted entry`:'engine report'}/>
   </div>
   {estimate&&!estimate.fresh&&<p className="mt-compact-note mt-basket-stale">Last known estimate · cycle {estimate.cycleId}. Current basket P&amp;L is unverified.</p>}
   {engine.entrySuspended===true&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>Entries suspended · resolve blockers and reconcile before a new cycle.</span></p>}
   <ReportDrawer title="L6–L10 & risk details" meta={decision?'L'+decision.layer:'No decision'}>
    <div className="mt-telemetry-grid">
     <Datum icon="wallet" label="Open P&L + swap" value={usd(owned?.value)} hint="owned positions"/>
     <Datum icon="spread" label="Adverse distance" value={fmt(decision?.distance_points)} hint={engine.policy==='CLOSE_DISTANCE_RISK_V51'?'>1,700 pts at close':'min 1,700 pts'}/>
     <Datum icon="activity" label="Body / ATR" value={fmt(decision?.body_atr)} hint={engine.policy==='CLOSE_DISTANCE_RISK_V51'?'Sizing input':'min 0.50'}/>
     <Datum icon="activity" label="Body / range" value={fmt(decision?.body_range)} hint={engine.policy==='CLOSE_DISTANCE_RISK_V51'?'Observed only':'min 0.55'}/>
     <Datum icon="repeat" label={engine.policy==='CLOSE_DISTANCE_RISK_V51'?"Close signal":"Reversal"} value={engine.policy==='CLOSE_DISTANCE_RISK_V51'?(decision?decision.accepted?'Passed':'Waiting':'—'):(decision?.structuralReversal===true?'Confirmed':decision?.structuralReversal===false?'Not confirmed':'—')}/>
     <Datum icon="shield" label="Broker flat" value={engine.brokerFlatReconciled===true?'Reported':'Unverified'}/>
    </div>
    <dl className="mt-detail-list">
     <div><dt>TP price</dt><dd>{engine.targetPrice!=null?engine.targetPrice.toFixed(3):'Unverified'}</dd></div>
     <div><dt>Decision</dt><dd>{decision?.reasons.join(' · ')||'No fresh decision'}</dd></div>
     <div><dt>Authorization</dt><dd>{engine.authorization} · {newsTime(engine.authorizationExpiresMs)}</dd></div>
     <div><dt>Closed candle</dt><dd>{newsTime(decision?.candleCloseMs??null)}</dd></div>
     <div><dt>Cycle</dt><dd>{engine.cycleId||'—'}</dd></div>
     <div><dt>Engine report</dt><dd>{newsTime(engine.observedMs)}</dd></div>
    </dl>
    <p className="mt-compact-note">ATR TP measures price distance from the volume-weighted entry; fees and swap can affect realized profit. Basket estimate uses cached realized results. Open P&amp;L excludes realized results and some costs. A fresh report does not verify protection.</p>
   </ReportDrawer>
  </ReportSection>

  <GrowthChart raw={data?.growthHistory} now={now}/>
  <ReportSection title="Overview" className="mt-u-panel mt-summary" aria-labelledby="summary-title" header={<div className="mt-u-panel-head"><h2 id="summary-title"><I name="dashboard"/> Overview</h2>
    <button className="mt-u-detail" type="button" onClick={()=>onNavigate('overview')}>Detail <I name="arrow" size={14}/></button></div>}>

   <div className="mt-summary-grid">
    <Datum icon="wallet" label="Demo Equity · Current" value={usd(displayMarket?.equity)} hint={market?undefined:marketLabel}/>
    <Datum icon="receipt" label="Net · Completed Cycles" value={usd(batch?.net_completed_usd)}/>
    <Datum icon="repeat" label="Total Executed Cycle" value={fmt(executedCycles)}/>
    <Datum icon="check" label="Completed / Requested" value={batch?`${batch.completed} / ${batch.requested}`:'—'}/>
   </div>
   <div className="mt-summary-foot"><span>Wins / losses <strong>{batch?`${batch.wins} / ${batch.losses}`:'—'}</strong></span>
    <button className="mt-u-detail" type="button" onClick={()=>onNavigate('cycles')}>Cycle Monitor <I name="arrow" size={14}/></button></div>
   <p className="mt-compact-note">Batch <strong>{batch?.status.replaceAll('_',' ')||'Unavailable'}</strong>{batch&&!batch.fresh&&' · Historical snapshot'}</p>
   {!!batch?.blockers.length&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>{batch.blockers.join(' · ')}</span></p>}
  </ReportSection>

  <ReportSection title="Telemetry" className="mt-u-panel" aria-labelledby="telemetry-title" header={<div className="mt-u-panel-head"><h2 id="telemetry-title"><I name="activity"/> Telemetry</h2>
    <span className="mt-u-chip">{marketLabel}</span></div>}>

   <p className="mt-compact-note mt-telemetry-freshness" role="status">{market?'Updates every second.':displayMarket?'Showing last known values. Waiting for a fresh snapshot.':'Waiting for the first verified snapshot.'}</p>
   <div className="mt-telemetry-grid">
    <Datum icon="spread" label="Spread" value={fmt(displayMarket?.spreadPoints)} hint="points"/>
    <Datum icon="activity" label="ATR 14" value={fmt(displayMarket?.atr14)} hint={displayMarket?.atrTimeframe||'M1'}/>
    <Datum icon="layers" label="Positions" value={fmt(displayMarket?.positionsCount)} hint="account"/>
    <Datum icon="clock" label="Pending" value={fmt(displayMarket?.pendingOrdersCount)} hint="account"/>
    <Datum icon="wallet" label="Used margin" value={fmt(displayMarket?.margin)} hint={displayMarket?.accountCurrency||'—'}/>
    <Datum icon="shield" label="Free margin" value={fmt(displayMarket?.freeMargin)} hint={displayMarket?.accountCurrency||'—'}/>
   </div>
   <p className="mt-compact-note">{displayMarket?.brokerName||'Broker unverified'} · {displayMarket?.symbol||'—'} · {displayMarket?.accountMode||'—'}</p>
   <ReportDrawer title="Market details" meta={marketLabel}>
    <div className="mt-telemetry-grid">
     <Datum icon="spread" label="Bid / Ask" value={`${fmt(displayMarket?.bid)} / ${fmt(displayMarket?.ask)}`}/>
     <Datum icon="receipt" label="Commission" value={fmt(displayMarket?.commissionUsdPerLot)} hint="USD / lot"/>
     <Datum icon="arrow" label="Slippage" value={fmt(displayMarket?.slippagePoints)} hint="points"/>
     <Datum icon="activity" label="Volatility" value={fmt(displayMarket?.volatilityPct,'%')} hint={displayMarket?.volatilityWindow}/>
     <Datum icon="shield" label="Margin level" value={fmt(displayMarket?.marginLevelPct,'%')}/>
     <Datum icon="alert" label="Foreign exposure" value={displayMarket?.foreignExposure===true?'Present':displayMarket?.foreignExposure===false?'None':'—'}/>
    </div>
    <dl className="mt-detail-list">
     <div><dt>MT5 observer</dt><dd>{market?'Demo · read-only':displayMarket?'Last known · read-only':'Unverified'}</dd></div>
     <div><dt>Paper adapter</dt><dd>{displayMarket?.executionAdapter==='INTERNAL_PAPER_ONLY'?'Internal paper only':'Unverified'}</dd></div>
     <div><dt>Last snapshot</dt><dd>{time(displayMarket?.observedAt)}</dd></div>
    </dl>
    {displayMarket?.atrRecomputed&&<p className="mt-compact-note">ATR recalculated from closed M1 bars.</p>}
   </ReportDrawer>
  </ReportSection>

  <SkillManager activation={demoRuntime} token={token} engineRaw={market?.engineDiagnostics} now={now}/>



  <ReportSection title="News Guard" className="mt-u-panel" aria-labelledby="news-title" header={<div className="mt-u-panel-head"><h2 id="news-title"><I name="news"/> News Guard</h2>
    <span className="mt-u-chip">{calendar.status==='CLEAR'?'Clear':calendar.status==='BLACKOUT'?'Blackout':'Unavailable'}</span></div>}>

   <NewsStatus raw={data?.news} now={now}/>
   <ReportDrawer title="Calendar details" meta="±60 min · all currencies">
    <dl className="mt-detail-list">
     <div><dt>Source</dt><dd>Forex Factory · high impact</dd></div>
     <div><dt>Confirmed</dt><dd>{newsTime(calendar.observedAt)}</dd></div>
     <div><dt>Valid until</dt><dd>{newsTime(calendar.validUntil)}</dd></div>
     <div><dt>Next refresh</dt><dd>{newsTime(calendar.nextRefreshAt)}</dd></div>
     <div><dt>Policy</dt><dd>{calendar.reason}</dd></div>
    </dl>
    <p className="mt-compact-note">Schedules may change. News clear does not verify quote, spread, margin or broker-flat readiness.</p>
   </ReportDrawer>
  </ReportSection>


  <ReportSection title="System &amp; Activity" className="mt-u-panel" aria-labelledby="system-summary-title" header={<div className="mt-u-panel-head"><h2 id="system-summary-title"><I name="terminal"/> System &amp; Activity</h2>
    <button className="mt-u-detail" type="button" onClick={()=>onNavigate('system')}>Detail <I name="arrow" size={14}/></button></div>}>

   <div className="mt-system-summary"><span>API <strong>{data?.infrastructure.memberApi||'Unknown'}</strong></span>
    <span>Worker <strong>{data?.infrastructure.masterWorker||'Unknown'}</strong></span>
    <button type="button" className="mt-u-detail" onClick={()=>onNavigate('anomalies')}>Anomalies <strong>{fmt(data?.master.anomalies)}</strong><I name="arrow" size={14}/></button></div>
   <TerminalMirror raw={data?.terminalMirror} now={now}/>
   <ReportDrawer title="Worker events" meta={data?.terminal?`${data.terminal.length} events`:'Unavailable'}>
    <div className="mt-u-filter" role="group" aria-label="Terminal event filter">
     {(['all','warning','critical'] as const).map(f=><button type="button" key={f} aria-pressed={terminalFilter===f}
      onClick={()=>setTerminalFilter(f)} className={terminalFilter===f?'active':''}>{f}</button>)}
    </div>
    <div className="mt-u-terminal-window" role="log" aria-label="Verified Master Trader terminal events">
     {terminal.length===0?<p className="mt-u-terminal-empty">No events yet.</p>:terminal.map(row=><div className="mt-u-term-line" key={row.id}>
      <span>{time(row.at)}</span><strong data-severity={row.severity}>{row.kind}</strong><p>{row.message}</p></div>)}
    </div>
    <p className="mt-compact-note">Supervisor · {time(data?.master.heartbeatAt)}</p>
   </ReportDrawer>
  </ReportSection>
 </div>;
}
