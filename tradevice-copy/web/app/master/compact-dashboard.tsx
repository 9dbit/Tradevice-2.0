'use client';
import {useEffect,useMemo,useState} from 'react';
import type {Snapshot} from './master-console';
import {validateEngine,validateOwned} from '../../lib/engine-diagnostics.mjs';
import {validateBatch} from '../../lib/demo-batch.mjs';
import SkillManager from './skill-manager';
import DemoControl,{useDemoRuntime} from './demo-control';
import {validateNews} from '../../lib/news-calendar.mjs';
import {ReportIcon as I,ReportDrawer,TelemetryDatum as Datum} from './report-ui';

type Details='overview'|'cycles'|'anomalies'|'system';
function fmt(value:number|null|undefined,unit=''){
 return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2})+unit:'—';
}
function time(ts:string|null|undefined) {
 if(!ts || !Number.isFinite(Date.parse(ts)))return '—';
 return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',
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
 const engine=validateEngine(market?.engineDiagnostics,now);
 const owned=validateOwned(market?.ownedPositionPnl);
 const decision=engine.decision;
 const batch=validateBatch(data?.demoBatch??data?.market?.demoBatch,now);
 const executedCycles=batch?batch.cycles.filter(c=>c.layers>0).length:null;
 const usd=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const newsTime=(value:number|null)=>value===null?'—':time(new Date(value).toISOString());
 const countdownTarget=calendar.status==='BLACKOUT'?calendar.blackoutUntil:calendar.nextEvent?.blackoutStart;
 const seconds=countdownTarget==null?null:Math.max(0,Math.ceil((countdownTarget-now)/1000));
 const countdown=seconds===null?'—':`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`;
 const [terminalFilter,setTerminalFilter]=useState<'all'|'warning'|'critical'>('all');
 const terminal=useMemo(()=>(data?.terminal||[]).filter(e=>terminalFilter==='all'||
   e.severity===terminalFilter).slice().sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)),
 [data?.terminal,terminalFilter]);
 const diagnostic=data?.diagnostic?.code;

 return <div className="mt-unified mt-dense-dashboard">
  {diagnostic&&<div className="mt-u-diagnostic" role="alert"><I name="alert"/>
   <div><strong>Telemetry belum tersambung</strong><p>{diagnostic}</p></div></div>}
  <DemoControl token={token} runtime={demoRuntime} refresh={refreshDemo} now={now}/>

  <section className="mt-u-panel mt-summary" aria-labelledby="summary-title">
   <div className="mt-u-panel-head"><h2 id="summary-title"><I name="dashboard"/> Overview</h2>
    <button className="mt-u-detail" type="button" onClick={()=>onNavigate('overview')}>Detail <I name="arrow" size={14}/></button></div>
   <div className="mt-summary-grid">
    <Datum icon="wallet" label="Demo Equity · Current" value={usd(market?.equity)}/>
    <Datum icon="receipt" label="Net · Completed Cycles" value={usd(batch?.net_completed_usd)}/>
    <Datum icon="repeat" label="Total Executed Cycle" value={fmt(executedCycles)}/>
    <Datum icon="check" label="Completed / Requested" value={batch?`${batch.completed} / ${batch.requested}`:'—'}/>
   </div>
   <div className="mt-summary-foot"><span>Wins / losses <strong>{batch?`${batch.wins} / ${batch.losses}`:'—'}</strong></span>
    <button className="mt-u-detail" type="button" onClick={()=>onNavigate('cycles')}>Cycle Monitor <I name="arrow" size={14}/></button></div>
   <p className="mt-compact-note">Batch <strong>{batch?.status.replaceAll('_',' ')||'Belum tersedia'}</strong>{batch&&!batch.fresh&&' · Snapshot historis'}</p>
   {!!batch?.blockers.length&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>{batch.blockers.join(' · ')}</span></p>}
  </section>

  <section className="mt-u-panel" aria-labelledby="telemetry-title">
   <div className="mt-u-panel-head"><h2 id="telemetry-title"><I name="activity"/> Telemetry</h2>
    <span className="mt-u-chip">{market?'Fresh':'Stale'}</span></div>
   <div className="mt-telemetry-grid">
    <Datum icon="spread" label="Spread" value={fmt(market?.spreadPoints)} hint="points"/>
    <Datum icon="activity" label="ATR 14" value={fmt(market?.atr14)} hint={market?.atrTimeframe||'M1'}/>
    <Datum icon="layers" label="Positions" value={fmt(market?.positionsCount)} hint="account"/>
    <Datum icon="clock" label="Pending" value={fmt(market?.pendingOrdersCount)} hint="account"/>
    <Datum icon="wallet" label="Used margin" value={fmt(market?.margin)} hint={market?.accountCurrency||'—'}/>
    <Datum icon="shield" label="Free margin" value={fmt(market?.freeMargin)} hint={market?.accountCurrency||'—'}/>
   </div>
   <p className="mt-compact-note">{market?.brokerName||'Broker belum terverifikasi'} · {market?.symbol||'—'} · {market?.accountMode||'—'}</p>
   <ReportDrawer title="Market details" meta={market?'Fresh':'Stale'}>
    <div className="mt-telemetry-grid">
     <Datum icon="spread" label="Bid / Ask" value={`${fmt(market?.bid)} / ${fmt(market?.ask)}`}/>
     <Datum icon="receipt" label="Commission" value={fmt(market?.commissionUsdPerLot)} hint="USD / lot"/>
     <Datum icon="arrow" label="Slippage" value={fmt(market?.slippagePoints)} hint="points"/>
     <Datum icon="activity" label="Volatility" value={fmt(market?.volatilityPct,'%')} hint={market?.volatilityWindow}/>
     <Datum icon="shield" label="Margin level" value={fmt(market?.marginLevelPct,'%')}/>
     <Datum icon="alert" label="Foreign exposure" value={market?.foreignExposure===true?'Present':market?.foreignExposure===false?'None':'—'}/>
    </div>
    <dl className="mt-detail-list">
     <div><dt>MT5 observer</dt><dd>{market?'Demo · read-only':'Unverified'}</dd></div>
     <div><dt>Paper adapter</dt><dd>{market?.executionAdapter==='INTERNAL_PAPER_ONLY'?'Internal paper only':'Unverified'}</dd></div>
     <div><dt>Last snapshot</dt><dd>{time(observed)}</dd></div>
    </dl>
    {market?.atrRecomputed&&<p className="mt-compact-note">ATR dihitung ulang dari closed M1.</p>}
   </ReportDrawer>
  </section>

  <SkillManager activation={demoRuntime} token={token} engineRaw={market?.engineDiagnostics} now={now}/>

  <section className="mt-u-panel" aria-labelledby="risk-title">
   <div className="mt-u-panel-head"><h2 id="risk-title"><I name="shield"/> Basket &amp; Adaptive</h2>
    <span className="mt-u-chip">{engine.entrySuspended===true?'Entry suspended':engine.status==='ENGINE_REPORTED'?engine.state||'Reported':'Unverified'}</span></div>
   <div className="mt-telemetry-grid">
    <Datum icon="activity" label="Basket estimate" value={usd(engine.pnl?.value)} hint="costs unverified"/>
    <Datum icon="shield" label="Hard loss" value={usd(engine.hardLossUsd)} hint={engine.riskExitCommitted===true?'Exit committed':'engine report'}/>
    <Datum icon="check" label="Basket TP" value={usd(engine.targetUsd)} hint="engine report"/>
   </div>
   {engine.entrySuspended===true&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>Entry dihentikan · cek blocker dan rekonsiliasi sebelum cycle baru.</span></p>}
   <ReportDrawer title="L6–L10 & risk details" meta={decision?'L'+decision.layer:'No decision'}>
    <div className="mt-telemetry-grid">
     <Datum icon="wallet" label="Open P&L + swap" value={usd(owned?.value)} hint="owned positions"/>
     <Datum icon="spread" label="Adverse distance" value={fmt(decision?.distance_points)} hint="min 1,700 pts"/>
     <Datum icon="activity" label="Body / ATR" value={fmt(decision?.body_atr)} hint="min 0.50"/>
     <Datum icon="activity" label="Body / range" value={fmt(decision?.body_range)} hint="min 0.55"/>
     <Datum icon="repeat" label="Reversal" value={decision?.structuralReversal===true?'Confirmed':decision?.structuralReversal===false?'Not confirmed':'—'}/>
     <Datum icon="shield" label="Broker flat" value={engine.brokerFlatReconciled===true?'Reported':'Unverified'}/>
    </div>
    <dl className="mt-detail-list">
     <div><dt>Decision</dt><dd>{decision?.reasons.join(' · ')||'No fresh decision'}</dd></div>
     <div><dt>Authorization</dt><dd>{engine.authorization} · {newsTime(engine.authorizationExpiresMs)}</dd></div>
     <div><dt>Closed candle</dt><dd>{newsTime(decision?.candleCloseMs??null)}</dd></div>
     <div><dt>Cycle</dt><dd>{engine.cycleId||'—'}</dd></div>
     <div><dt>Engine report</dt><dd>{newsTime(engine.observedMs)}</dd></div>
    </dl>
    <p className="mt-compact-note">Basket estimate memakai cached realized. Open P&amp;L belum termasuk realized dan seluruh commission. Fresh report bukan bukti proteksi terverifikasi.</p>
   </ReportDrawer>
  </section>

  <section className="mt-u-panel" aria-labelledby="news-title">
   <div className="mt-u-panel-head"><h2 id="news-title"><I name="news"/> News Guard</h2>
    <span className="mt-u-chip">{calendar.status==='CLEAR'?'Clear':calendar.status==='BLACKOUT'?'Blackout':'Unavailable'}</span></div>
   <div className="mt-news-summary"><div><strong>{calendar.nextEvent?.title||(calendar.status==='CLEAR'?'Tidak ada event dalam coverage':'Jadwal belum terverifikasi')}</strong>
    <span>{calendar.nextEvent?.currency||'—'} · {newsTime(calendar.nextEvent?.at??null)}</span></div>
    <div><small>{calendar.status==='BLACKOUT'?'Berakhir dalam':'Blackout dalam'}</small><strong>{countdown}</strong></div></div>
   {calendar.status!=='CLEAR'&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>No trade · {calendar.reason}</span></p>}
   <ReportDrawer title="Calendar details" meta="±60 min · all currencies">
    <dl className="mt-detail-list">
     <div><dt>Source</dt><dd>Forex Factory · high impact</dd></div>
     <div><dt>Confirmed</dt><dd>{newsTime(calendar.observedAt)}</dd></div>
     <div><dt>Valid until</dt><dd>{newsTime(calendar.validUntil)}</dd></div>
     <div><dt>Next refresh</dt><dd>{newsTime(calendar.nextRefreshAt)}</dd></div>
     <div><dt>Policy</dt><dd>{calendar.reason}</dd></div>
    </dl>
    <p className="mt-compact-note">Jadwal dapat berubah. News clear bukan bukti quote, spread, margin atau broker-flat siap.</p>
   </ReportDrawer>
  </section>

  <section className="mt-u-panel" aria-labelledby="system-summary-title">
   <div className="mt-u-panel-head"><h2 id="system-summary-title"><I name="terminal"/> System &amp; Activity</h2>
    <button className="mt-u-detail" type="button" onClick={()=>onNavigate('system')}>Detail <I name="arrow" size={14}/></button></div>
   <div className="mt-system-summary"><span>API <strong>{data?.infrastructure.memberApi||'Unknown'}</strong></span>
    <span>Worker <strong>{data?.infrastructure.masterWorker||'Unknown'}</strong></span>
    <button type="button" className="mt-u-detail" onClick={()=>onNavigate('anomalies')}>Anomalies <strong>{fmt(data?.master.anomalies)}</strong><I name="arrow" size={14}/></button></div>
   <ReportDrawer title="Terminal activity" meta={data?.terminal?`${data.terminal.length} events`:'Unavailable'}>
    <div className="mt-u-filter" role="group" aria-label="Terminal event filter">
     {(['all','warning','critical'] as const).map(f=><button type="button" key={f} aria-pressed={terminalFilter===f}
      onClick={()=>setTerminalFilter(f)} className={terminalFilter===f?'active':''}>{f}</button>)}
    </div>
    <div className="mt-u-terminal-window" role="log" aria-label="Verified Master Trader terminal events">
     {terminal.length===0?<p className="mt-u-terminal-empty">Belum ada event.</p>:terminal.map(row=><div className="mt-u-term-line" key={row.id}>
      <span>{time(row.at)}</span><strong data-severity={row.severity}>{row.kind}</strong><p>{row.message}</p></div>)}
    </div>
    <p className="mt-compact-note">Supervisor · {time(data?.master.heartbeatAt)}</p>
   </ReportDrawer>
  </section>
 </div>;
}
