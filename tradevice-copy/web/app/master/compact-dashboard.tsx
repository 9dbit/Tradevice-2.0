'use client';
import {useEffect,useMemo,useState} from 'react';
import type {Snapshot} from './master-console';
import {validateEngine,validateOwned} from '../../lib/engine-diagnostics.mjs';
import {validateBatch} from '../../lib/demo-batch.mjs';
import SkillManager from './skill-manager';
import DemoControl,{useDemoRuntime} from './demo-control';
import {validateNews} from '../../lib/news-calendar.mjs';

type Details='overview'|'cycles'|'anomalies'|'risk'|'journal'|'system';
type IconName='dashboard'|'activity'|'shield'|'alert'|'repeat'|'receipt'|'terminal'|'news'|'play'|'stop'|'reset'|'clock'|'arrow';
function I({name,size=18}:{name:IconName;size?:number}){
 const props={fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round' as const,
   strokeLinejoin:'round' as const};
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...props}>
  {name==='dashboard'&&<><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></>}
  {name==='activity'&&<path d="M2 12h5l3-8 4 16 3-8h5"/>}
  {name==='shield'&&<><path d="m12 2 8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>}
  {name==='alert'&&<><path d="m12 3 10 18H2L12 3z"/><path d="M12 9v5m0 4h.01"/></>}
  {name==='repeat'&&<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a7 7 0 0 1 12-2l3 5M4 12l3 5a7 7 0 0 0 12-2"/></>}
  {name==='receipt'&&<><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3z"/><path d="M8 8h8M8 12h8M8 16h5"/></>}
  {name==='terminal'&&<><rect x="2" y="3" width="20" height="18" rx="3"/><path d="m6 8 4 4-4 4M12 16h5"/></>}
  {name==='news'&&<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M7 16h10M14 12h3"/></>}
  {name==='play'&&<path d="m8 5 11 7-11 7V5z"/>}
  {name==='stop'&&<rect x="5" y="5" width="14" height="14" rx="3"/>}
  {name==='reset'&&<><path d="M3 12a9 9 0 1 0 3-7"/><path d="M3 3v6h6"/></>}
  {name==='clock'&&<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
  {name==='arrow'&&<path d="M5 12h14m-6-6 6 6-6 6"/>}
 </svg>;
}
function fmt(value:number|null|undefined,unit=''){
 return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US')+unit:'—';
}
function time(ts:string|null|undefined) {
 if(!ts || !Number.isFinite(Date.parse(ts)))return '—';
 return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',
   second:'2-digit',day:'2-digit',month:'short',hour12:false}).format(new Date(ts))+' WIB';
}
function Panel({title,icon,subtitle,children,go}:{
 title:string;icon:IconName;subtitle?:string;children:React.ReactNode;go?:()=>void;
}){
 return <section className="mt-u-card">
  <div className="mt-u-card-top"><div className="mt-u-card-title"><I name={icon}/><strong>{title}</strong></div>
    {go&&<button type="button" onClick={go} className="mt-u-detail">Detail <I name="arrow" size={13}/></button>}</div>
  {subtitle&&<p className="mt-u-card-sub">{subtitle}</p>}
  {children}
 </section>;
}
function Datum({name,value,metric=false,hint}:{name:string;value:string;metric?:boolean;hint?:string}) {
 return <div className={'mt-u-datum'+(metric?' mt-u-datum-metric':'')}><span>{name}</span><strong>{value}</strong>{hint&&<small>{hint}</small>}</div>;
}
export default function CompactDashboard({data,token,onNavigate,onUpdated}:{
 data:Snapshot|null;token:string;onNavigate:(tab:Details)=>void;onUpdated:()=>void;
}){
 const {runtime:demoRuntime,refresh:refreshDemo}=useDemoRuntime(token);
 const control=data?.control;
 const market=data?.market;
 const [newsClock,setNewsClock]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNewsClock(Date.now()),1000);return ()=>clearInterval(timer);},[]);
 const calendar=validateNews(data?.news,newsClock);
 const marketFresh=market?.observedAt!=null&&newsClock-Date.parse(market.observedAt)>=0&&newsClock-Date.parse(market.observedAt)<=8000;
 const engine=validateEngine(marketFresh?market?.engineDiagnostics:null,newsClock);
 const owned=validateOwned(marketFresh?market?.ownedPositionPnl:null);
 const decision=engine.decision;
 const batch=validateBatch(data?.demoBatch??market?.demoBatch,newsClock);
 const executedCycles=batch?batch.cycles.filter(c=>c.layers>0).length:null;
 const usd=(value:number)=>'$'+value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const newsTime=(value:number|null)=>value===null?'—':time(new Date(value).toISOString());
 const countdownTarget=calendar.status==='BLACKOUT'?calendar.blackoutUntil:calendar.nextEvent?.blackoutStart;
 const seconds=countdownTarget==null?null:Math.max(0,Math.ceil((countdownTarget-newsClock)/1000));
 const countdown=seconds===null?'—':`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`;
 const workerAvailable=data?.infrastructure.masterWorker==='ONLINE';
 const diagnostic=data?.diagnostic?.code || null;
 const [sort,setSort]=useState<'desc'|'asc'>('desc');
 const [terminalFilter,setTerminalFilter]=useState<'all'|'warning'|'critical'>('all');
 const sorted=useMemo(()=>(data?.paperOrders||[]).slice().sort((a,b)=>{
   const delta=(Date.parse(a.at)||0)-(Date.parse(b.at)||0);
   return sort==='asc'?delta:-delta;
 }),[data?.paperOrders,sort]);
 const terminal=useMemo(()=>(data?.terminal||[]).filter(e=>terminalFilter==='all'||
   e.severity===terminalFilter).sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)),
 [data?.terminal,terminalFilter]);
 
 return <div className="mt-unified">
  {diagnostic&&<div className="mt-u-diagnostic" role="alert">
    <I name="alert" size={18}/>
    <div><strong>Telemetry Master belum tersambung</strong>
      <p>{diagnostic}. Periksa koneksi `MASTER_READ_DATABASE_URL` pada copy-api staging.
      Konfigurasi dan eksekusi terkunci sampai identitas reader serta heartbeat terverifikasi.</p>
    </div>
  </div>}
  <DemoControl token={token} runtime={demoRuntime} refresh={refreshDemo} now={newsClock}/>
  <div className="mt-u-grid">
    <Panel title="Overview" icon="dashboard" go={()=>onNavigate('overview')}>
      <Datum metric name="Demo Equity · Current" value={marketFresh&&typeof market?.equity==='number'?usd(market.equity):'—'}/>
      <Datum metric name="Demo Net · Completed Cycles" value={batch?usd(batch.net_completed_usd):'—'}/>
      <Datum metric name="Wins / Losses · Demo Batch" value={batch?`${batch.wins} / ${batch.losses}`:'—'}/>
    </Panel>
    <Panel title="Cycle Monitor" icon="repeat" go={()=>onNavigate('cycles')}>
      <Datum metric name="Total Executed Cycle" value={fmt(executedCycles)} hint="Current demo batch · cycles with broker fills"/>
      <Datum metric name="Demo Completed / Requested" value={batch?`${batch.completed} / ${batch.requested}`:'—'}/>
      <Datum name="Demo Batch State" value={batch?.status||'NOT CONNECTED'}/>
      <p className="mt-u-card-sub">Supervisor ticks: {fmt(data?.master.cycles)} · monitoring only</p>
    </Panel>
    <Panel title="System Health" icon="activity" go={()=>onNavigate('system')}>
      <Datum name="Member API" value={data?.infrastructure.memberApi||'UNKNOWN'}/>
      <Datum name="Worker" value={data?.infrastructure.masterWorker||'UNKNOWN'}/>
      <Datum name="Journal" value={data?.infrastructure.journal||'UNKNOWN'}/>
    </Panel>
    <Panel title="Risk & Safety" icon="shield" go={()=>onNavigate('risk')}>
      <Datum name="Kill switch" value={data?.risk.killSwitch||'UNAVAILABLE'}/>
      <Datum name="Drawdown" value={fmt(data?.risk.drawdownPct,'%')}/>
      <Datum name="Quote feed" value={control?.quotesReady?'VERIFIED':'NOT READY'}/>
    </Panel>
    <Panel title="Anomaly Center" icon="alert" go={()=>onNavigate('anomalies')}>
      <Datum name="Total anomalies" value={fmt(data?.master.anomalies)}/>
      <Datum name="Supervisor state" value={data?.master.state||'OFFLINE'}/>
      <Datum name="Reason" value={data?.master.reason||'—'}/>
    </Panel>
    <Panel title="Paper Journal" icon="receipt" go={()=>onNavigate('journal')}>
      <Datum name="Journal entries" value={data?.paperOrders?String(data.paperOrders.length):'—'}/>
      <Datum name="Accepted paper" value={fmt(data?.queue?.accepted)}/>
      <Datum name="Pending signals" value={fmt(data?.queue?.queued)}/>
    </Panel>
  </div>
  <section className="mt-u-panel mt-u-market">
    <div className="mt-u-panel-head">
      <div><span className="mt-u-overline">REAL BROKER EVIDENCE · NO SYNTHETIC VALUES</span>
        <h2><I name="activity"/> Broker & Market Conditions</h2>
      </div>
      <span className="mt-u-chip">{market?.status==='OBSERVED_READ_ONLY'?'MT5 DEMO · READ-ONLY':'NOT CONNECTED'}</span>
    </div>
    <p className="mt-u-hint">{market?.status==='OBSERVED_READ_ONLY'?
      'Observasi broker demo sudah diterima dengan validasi HMAC. Data ini hanya untuk monitoring; Start Cycle tetap terkunci sampai seluruh preflight dan adapter eksekusi tervalidasi.':
      'Feed MT5 belum tersedia atau quote terakhir sudah stale. Data broker hanya tampil dari observer staging terautentikasi, bukan simulasi.'}</p>
    <div className="mt-u-market-grid">
      <div className="mt-u-market-cell"><small>Broker</small><strong>{market?.brokerName||'Not connected'}</strong>
        <span>Account: {market?.accountMode||'Not linked'}</span></div>
      <div className="mt-u-market-cell"><small>Current Spread</small>
        <strong>{fmt(market?.spreadPoints)}</strong><span>points · bid/ask</span></div>
      <div className="mt-u-market-cell"><small>Commission</small>
        <strong>{fmt(market?.commissionUsdPerLot)}</strong><span>USD / lot · verified cost</span></div>
      <div className="mt-u-market-cell"><small>Slippage</small>
        <strong>{fmt(market?.slippagePoints)}</strong><span>points · decision vs fill</span></div>
      <div className="mt-u-market-cell"><small>Volatility</small>
        <strong>{fmt(market?.volatilityPct,'%')}</strong>
        <span>{market?.volatilityWindow||'awaiting completed candles'}</span></div>
      <div className="mt-u-market-cell"><small>ATR (14)</small>
        <strong>{fmt(market?.atr14)}</strong>
        <span>{market?.atrTimeframe||'M1'} · {market?.atrRecomputed?'recalculated from closed bars':'price units'}</span></div>
      <div className="mt-u-market-cell"><small>Demo Equity</small>
        <strong>{fmt(market?.equity)}</strong><span>{market?.accountCurrency||'currency unavailable'} · read-only</span></div>
      <div className="mt-u-market-cell"><small>Used / Free Margin</small>
        <strong>{fmt(market?.margin)} / {fmt(market?.freeMargin)}</strong>
        <span>{market?.accountCurrency||'currency unavailable'} · level {fmt(market?.marginLevelPct,'%')}</span></div>
      <div className="mt-u-market-cell"><small>Positions / Pending</small>
        <strong>{fmt(market?.positionsCount)} / {fmt(market?.pendingOrdersCount)}</strong>
        <span>{market?.foreignExposure===true?'Foreign exposure present':market?.foreignExposure===false?'No foreign exposure observed':'awaiting account snapshot'}</span></div>
    </div>
    <div className="mt-u-market-foot">
      <span>Execution adapter: <strong>{market?.executionAdapter==='INTERNAL_PAPER_ONLY'?'Internal paper only':'Not configured'}</strong></span>
      <span>MT5 Observer: <strong>{market?.status==='OBSERVED_READ_ONLY'?'Demo · read-only':'Not connected / stale'}</strong></span>
      <span>Last quote: <strong>{time(market?.observedAt)}</strong></span>
    </div>
  </section>
  <SkillManager activation={demoRuntime} token={token} engineRaw={marketFresh?market?.engineDiagnostics:null} now={newsClock}/>
  <section className="mt-u-panel mt-u-market" aria-label="Engine and basket diagnostics">
    <div className="mt-u-panel-head"><div><span className="mt-u-overline">ENGINE EVIDENCE · READ-ONLY</span>
      <h2><I name="shield"/> Adaptive Entry &amp; Basket Risk</h2></div>
      <span className="mt-u-chip">{engine.status.replaceAll('_',' ')}</span></div>
    <p className="mt-u-hint">Batas strategi: −$120 hard loss dan +$3.50 target. Batas konfigurasi tidak membuktikan pengawasan aktif atau menjamin harga exit. Laporan engine kedaluwarsa dalam 8 detik; P&amp;L evaluasi dalam 5 detik.</p>
    <div className="mt-u-market-grid">
      <div className="mt-u-market-cell"><small>Open positions profit + swap</small><strong>{fmt(owned?.value,' USD')}</strong>
        <span>GoldTrap magic + symbol · belum termasuk realized dan seluruh commission</span></div>
      <div className="mt-u-market-cell"><small>Last engine basket valuation</small><strong>{fmt(engine.pnl?.value,' USD')}</strong>
        <span>{engine.pnl?'Executable estimate + cached realized; costs not fully verified':'No fresh engine valuation'}</span></div>
      <div className="mt-u-market-cell"><small>Hard loss / risk exit</small><strong>{fmt(engine.hardLossUsd,' USD')}</strong>
        <span>{engine.riskExitCommitted===true?'EXIT COMMITTED':engine.pnl?'Recent valuation reported; protection not attested':'Supervision NOT VERIFIED'}</span></div>
      <div className="mt-u-market-cell"><small>Cycle state</small><strong>{engine.state||'—'}</strong>
        <span>{engine.cycleId||'No fresh cycle identity'} · flat reconciliation: {engine.brokerFlatReconciled===true?'REPORTED':'NOT VERIFIED'}</span></div>
      <div className="mt-u-market-cell"><small>Adaptive layer / adverse distance</small><strong>{decision?'L'+decision.layer+' · '+fmt(decision.distance_points)+' pts':'—'}</strong>
        <span>Minimum 1,700 points from actual fill · closed M1</span></div>
      <div className="mt-u-market-cell"><small>Body / ATR · body / range</small><strong>{fmt(decision?.body_atr)} / {fmt(decision?.body_range)}</strong>
        <span>Minimum 0.50 / 0.55 · ATR {fmt(decision?.atr)}</span></div>
      <div className="mt-u-market-cell"><small>Structural reversal</small><strong>{decision?.structuralReversal===true?'CONFIRMED':decision?.structuralReversal===false?'NOT CONFIRMED':'—'}</strong>
        <span>Last evaluated candle: {newsTime(decision?.candleCloseMs??null)}</span></div>
      <div className="mt-u-market-cell"><small>Durable authorization</small><strong>{engine.authorization}</strong>
        <span>Expiry: {newsTime(engine.authorizationExpiresMs)} · guarded demo command lane</span></div>
    </div>
    <p className="mt-u-help">L6–L10: {decision?decision.reasons.join(' · '):'NO FRESH ENGINE DECISION'}. Engine report: {newsTime(engine.observedMs)}. Posisi kosong bukan bukti cycle COMPLETE.</p>
  </section>
  <section className="mt-u-panel mt-u-market" aria-label="Forex Factory news guard">
    <div className="mt-u-panel-head"><div><span className="mt-u-overline">FOREX FACTORY · HIGH IMPACT · ALL CURRENCIES</span>
      <h2><I name="news"/> News Safety Guard</h2></div>
      <span className="mt-u-chip">{calendar.status==='CLEAR'?'NEWS WINDOW CLEAR':'NO TRADE · '+calendar.status}</span></div>
    <p className="mt-u-hint">Entry baru diblokir 60 menit sebelum hingga 60 menit setelah setiap high-impact event. Window yang bertumpuk digabung. Kalender tidak tersedia atau basi: NO TRADE. Pengawasan basket tetap diperlukan.</p>
    <div className="mt-u-market-grid">
      <div className="mt-u-market-cell"><small>Next / active event</small><strong>{calendar.nextEvent?.title||'—'}</strong>
        <span>{calendar.nextEvent?.currency||'No verified upcoming event'} · {newsTime(calendar.nextEvent?.at??null)}</span></div>
      <div className="mt-u-market-cell"><small>{calendar.status==='BLACKOUT'?'Blackout ends in':'Blackout starts in'}</small>
        <strong>{countdown}</strong><span>{newsTime(countdownTarget??null)}</span></div>
      <div className="mt-u-market-cell"><small>Calendar freshness</small><strong>{calendar.status==='UNKNOWN'?'UNAVAILABLE / STALE':'FRESH'}</strong>
        <span>Confirmed: {newsTime(calendar.observedAt)} · expires: {newsTime(calendar.validUntil)}</span></div>
    </div>
    <p className="mt-u-help">Calendar: {calendar.reason}. Jadwal dapat berubah; kalender ini bukan bukti kesiapan eksekusi.</p>
    <div className="mt-u-preflight" aria-label="Alasan entry diblokir">
      <span>News <b>{calendar.status==='CLEAR'?'WINDOW CLEAR':'BLOCKED'}</b></span>
      <span>Execution quote <b>{control?.quotesReady?'READY':'NOT VERIFIED'}</b></span>
      <span>Execution adapter <b>{control?.brokerReady?'READY':'NOT READY'}</b></span>
      <span>Commission / slippage <b>NOT VERIFIED</b></span>
      <span>Demo order authorization <b>PER START CONFIRMATION</b></span>
    </div>
    <p className="mt-u-help">News CLEAR hanya menyatakan di luar window berita. Start tetap membutuhkan skill aktif, preflight, dan konfirmasi demo.</p>
  </section>
  <div className="mt-u-duo">
   <section className="mt-u-panel mt-u-terminal">
    <div className="mt-u-panel-head"><div><span className="mt-u-overline">VERIFIED EVENT STREAM</span><h2><I name="terminal"/> Terminal Activity</h2></div>
      <span className="mt-u-chip">15s refresh</span></div>
    <div className="mt-u-filter" role="group" aria-label="Terminal event filter">
      {(['all','warning','critical'] as const).map(f=><button key={f} aria-pressed={terminalFilter===f}
       onClick={()=>setTerminalFilter(f)} className={terminalFilter===f?'active':''}>{f.toUpperCase()}</button>)}
    </div>
    <div className="mt-u-terminal-window" role="log" aria-label="Verified Master Trader terminal events">
      {terminal.length===0?<p className="mt-u-terminal-empty">Belum ada event command yang tercatat. Tidak ada log sintetis.</p>:
        terminal.map(row=><div className="mt-u-term-line" key={row.id}>
          <span>{time(row.at)}</span><strong data-severity={row.severity}>{row.kind}</strong><p>{row.message}</p>
        </div>)}
    </div>
    <div className="mt-u-terminal-foot"><span>Supervisor heartbeat: {time(data?.master.heartbeatAt)}</span><span>Read-only event log</span></div>
   </section>
  </div>
  <section className="mt-u-panel mt-u-journal">
    <div className="mt-u-panel-head"><div><span className="mt-u-overline">CURRENT SESSION · VERIFIED ONLY</span><h2><I name="receipt"/> Paper Journal</h2></div>
      <button className="mt-u-sort" onClick={()=>setSort(s=>s==='desc'?'asc':'desc')} type="button">
        <I name="clock" size={15}/> Timestamp {sort==='desc'?'Newest ↓':'Oldest ↑'}</button>
    </div>
    <div className="mt-u-paper-wrap">
      {sorted.length===0?<div className="mt-u-paper-empty">Belum ada order paper yang terverifikasi dalam sesi ini.</div>:
        <table className="mt-u-paper-table"><thead><tr><th>Timestamp (WIB)</th><th>Instrument</th><th>Side</th><th>Lots</th><th>Status</th></tr></thead>
        <tbody>{sorted.map(order=><tr key={order.id}><td>{time(order.at)}</td><td>{order.symbol}</td>
          <td>{order.side}</td><td>{order.quantity}</td><td>{order.state}</td></tr>)}</tbody></table>}
    </div>
    <small className="mt-u-footnote">Menampilkan maksimal 50 order terbaru dalam sesi aktif. Reset tidak menghapus data historis. Fill belum diverifikasi.</small>
  </section>
 </div>;
}
