'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Snapshot} from './master-console';
import {validateNews} from '../../lib/news-calendar.mjs';

type Details='overview'|'cycles'|'anomalies'|'risk'|'journal'|'system';
type News='AVOID'|'ALLOW'|'ONLY';
type Cycle='CONTINUOUS'|'CUSTOM';
type Command='START'|'STOP'|'CONFIGURE'|'RESET_SESSION';
type CommandPhase='SENDING'|'QUEUED'|'APPLIED'|'REJECTED'|'DELAYED';
type CommandProgress={requestId:string;action:Command;phase:CommandPhase;errorCode?:string|null};

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
function Datum({name,value}:{name:string;value:string}) {
 return <div className="mt-u-datum"><span>{name}</span><strong>{value}</strong></div>;
}
export default function CompactDashboard({data,token,onNavigate,onUpdated}:{
 data:Snapshot|null;token:string;onNavigate:(tab:Details)=>void;onUpdated:()=>void;
}){
 const control=data?.control;
 const market=data?.market;
 const [cycleMode,setCycleMode]=useState<Cycle>('CONTINUOUS');
 const [target,setTarget]=useState('100');
 const news:News='AVOID';
 const [newsClock,setNewsClock]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNewsClock(Date.now()),1000);return ()=>clearInterval(timer);},[]);
 const calendar=validateNews(data?.news,newsClock);
 const newsTime=(value:number|null)=>value===null?'—':time(new Date(value).toISOString());
 const countdownTarget=calendar.status==='BLACKOUT'?calendar.blackoutUntil:calendar.nextEvent?.blackoutStart;
 const seconds=countdownTarget==null?null:Math.max(0,Math.ceil((countdownTarget-newsClock)/1000));
 const countdown=seconds===null?'—':`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`;
 const [dirty,setDirty]=useState(false);
 const [working,setWorking]=useState<Command|null>(null);
 const [commandProgress,setCommandProgress]=useState<CommandProgress|null>(null);
 const [feedback,setFeedback]=useState('');
 const onUpdatedRef=useRef(onUpdated);
 useEffect(()=>{onUpdatedRef.current=onUpdated;},[onUpdated]);
 const [confirmReset,setConfirmReset]=useState(false);
 const [confirmText,setConfirmText]=useState('');
 const [sort,setSort]=useState<'desc'|'asc'>('desc');
 const [terminalFilter,setTerminalFilter]=useState<'all'|'warning'|'critical'>('all');
 useEffect(()=>{
   if(!dirty&&control){
     setCycleMode(control.cycleMode);
     setTarget(String(control.targetCycles??100));
   }
 },[control?.cycleMode,control?.targetCycles,control?.newsPolicy,dirty]);
 const operatorAvailable=data?.source==='STAGING_WORKER_TELEMETRY'&&control?.operatorConfigured===true;
 const workerAvailable=data?.infrastructure.masterWorker==='ONLINE';
 const canOperate=!!operatorAvailable&&workerAvailable;
 const commandBusy=!!working||commandProgress?.phase==='QUEUED';
 const diagnostic=data?.diagnostic?.code || null;
 const engineReady=control?.quotesReady===true&&control?.brokerReady===true&&
   control?.newsCalendarReady===true&&data?.risk.killSwitch==='DISENGAGED';
 const newSession=control?.sessionId||null;
 const pending=(data?.commands||[]).filter(c=>c.status==='PENDING').length;
 const sorted=useMemo(()=>(data?.paperOrders||[]).slice().sort((a,b)=>{
   const delta=(Date.parse(a.at)||0)-(Date.parse(b.at)||0);
   return sort==='asc'?delta:-delta;
 }),[data?.paperOrders,sort]);
 const terminal=useMemo(()=>(data?.terminal||[]).filter(e=>terminalFilter==='all'||
   e.severity===terminalFilter).sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)),
 [data?.terminal,terminalFilter]);
 
 // Correlate with the exact server-side idempotency key.
 // Never treat a nearby terminal event or HTTP 202 as worker acknowledgement.
 useEffect(()=>{
   if(!commandProgress||!['QUEUED','DELAYED'].includes(commandProgress.phase))return;
   const row=data?.commands?.find(command=>command.requestId===commandProgress.requestId);
   if(!row)return;
   if(row.status==='APPLIED'){
     setCommandProgress(previous=>previous?.requestId===commandProgress.requestId
       ?{...previous,phase:'APPLIED',errorCode:null}:previous);
     setFeedback('');
     if(commandProgress.action==='CONFIGURE')setDirty(false);
     if(commandProgress.action==='RESET_SESSION'){
       setConfirmReset(false);setConfirmText('');
     }
   }else if(row.status==='REJECTED'){
     setCommandProgress(previous=>previous?.requestId===commandProgress.requestId
       ?{...previous,phase:'REJECTED',errorCode:row.errorCode}:previous);
     setFeedback('');
   }
 },[data?.commands,commandProgress?.requestId,commandProgress?.phase]);

 // Poll rapidly while the command is awaiting its actual worker receipt.
 // Never infer completion from a timer; overdue requests stay unconfirmed.
 useEffect(()=>{
   if(commandProgress?.phase!=='QUEUED')return;
   const requestId=commandProgress.requestId;
   const interval=window.setInterval(()=>onUpdatedRef.current(),2500);
   const timeout=window.setTimeout(()=>{
     setCommandProgress(previous=>previous?.requestId===requestId&&previous.phase==='QUEUED'
       ?{...previous,phase:'DELAYED'}:previous);
   },45000);
   return()=>{window.clearInterval(interval);window.clearTimeout(timeout);};
 },[commandProgress?.requestId,commandProgress?.phase]);

 const progressText=commandProgress?.phase==='SENDING'?'Mengirim command ke API…':
   commandProgress?.phase==='QUEUED'?'Diterima API · menunggu konfirmasi worker…':
   commandProgress?.phase==='APPLIED'?'Selesai · worker mengonfirmasi APPLIED':
   commandProgress?.phase==='REJECTED'?'Ditolak · '+(commandProgress.errorCode||'COMMAND_REJECTED'):
   commandProgress?.phase==='DELAYED'?'Konfirmasi worker terlambat · periksa Terminal Activity':'';
 async function command(action:Command) {
   if(!canOperate||commandBusy)return;
   if(action==='CONFIGURE'&&cycleMode==='CUSTOM'){
     const n=Number(target);
     if(!/^\d+$/.test(target)||!Number.isSafeInteger(n)||n<1||n>1000000){
       setFeedback('Target harus bilangan bulat 1 sampai 1.000.000.');return;
     }
   }
   if(action==='START'&&!engineReady){
     setFeedback('Start diblokir: trusted quote, kalender berita, dan paper broker belum siap.');return;
   }
   if(action==='RESET_SESSION'&&(!confirmReset||confirmText!=='RESET')){
     setFeedback('Konfirmasi reset diperlukan. Audit lama tidak dihapus.');return;
   }
   const requestId=crypto.randomUUID();
   setWorking(action);setFeedback('');
   setCommandProgress({requestId,action,phase:'SENDING'});
   try{
     const payload:Record<string,unknown>={action,requestId};
     if(action==='CONFIGURE'){
       payload.cycleMode=cycleMode;payload.newsPolicy=news;
       payload.targetCycles=cycleMode==='CUSTOM'?Number(target):null;
     }
     if(action==='RESET_SESSION')payload.confirmReset=true;
     const r=await fetch('/api/master/command',{method:'POST',headers:{
       'authorization':'Bearer '+token,'content-type':'application/json'},
       body:JSON.stringify(payload),cache:'no-store'});
     if(!r.ok){
       const result=await r.json().catch(()=>null);
       setCommandProgress({requestId,action,phase:'REJECTED',
         errorCode:result?.detail?.code||'COMMAND_UNAVAILABLE'});
     }else{
       const receipt=await r.json().catch(()=>null);
       if(receipt?.requestId!==requestId||!['PENDING','DUPLICATE'].includes(receipt?.status)){
         setCommandProgress({requestId,action,phase:'REJECTED',errorCode:'INVALID_COMMAND_ACK'});
       }else{
         // Preserve inputs until APPLIED is confirmed by worker.
         if(action==='CONFIGURE')setDirty(true);
         setCommandProgress({requestId,action,phase:'QUEUED'});
         onUpdatedRef.current();
       }
     }
   }catch{
     setCommandProgress({requestId,action,phase:'DELAYED'});
     setFeedback('Koneksi API terputus. Status command belum diketahui; periksa Terminal Activity sebelum mencoba lagi.');
   }
   finally{setWorking(null);}
 }
 return <div className="mt-unified">
  {diagnostic&&<div className="mt-u-diagnostic" role="alert">
    <I name="alert" size={18}/>
    <div><strong>Telemetry Master belum tersambung</strong>
      <p>{diagnostic}. Periksa koneksi `MASTER_READ_DATABASE_URL` pada copy-api staging.
      Konfigurasi dan eksekusi terkunci sampai identitas reader serta heartbeat terverifikasi.</p>
    </div>
  </div>}
  <div className="mt-u-statusline">
    <span className="mt-u-status"><i className={workerAvailable?'ok':''}/> Supervisor {workerAvailable?'ONLINE':'OFFLINE / STALE'}</span>
    <span>Trade admission: BLOCKED · Paper only</span>
    <span>Snapshot: {time(data?.observedAt)}</span>
  </div>
  <div className="mt-u-grid">
    <Panel title="Overview" icon="dashboard" go={()=>onNavigate('overview')}>
      <Datum name="Paper equity" value={typeof data?.risk.equityUsd==='number'?'$'+fmt(data.risk.equityUsd):'—'}/>
      <Datum name="Paper P&L" value={typeof data?.risk.pnlUsd==='number'?'$'+fmt(data.risk.pnlUsd):'—'}/>
      <Datum name="Win rate" value={fmt(data?.risk.winRatePct,'%')}/>
    </Panel>
    <Panel title="Cycle Monitor" icon="repeat" go={()=>onNavigate('cycles')}>
      <Datum name="Supervisor ticks" value={fmt(data?.master.cycles)}/>
      <Datum name="Strategy cycles" value={fmt(control?.strategyCycles)}/>
      <Datum name="Run state" value={control?.runStatus||'NOT CONNECTED'}/>
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
      <span>Demo order authorization <b>LOCKED</b></span>
    </div>
    <p className="mt-u-help">Keputusan L6–L10 dan basket P&amp;L belum terhubung ke telemetry engine. Nilainya tidak disimpulkan dari jumlah posisi observer. Start Cycle tetap terkunci.</p>
  </section>
  <div className="mt-u-duo">
   <section className="mt-u-panel mt-u-commands">
    <div className="mt-u-panel-head"><div><span className="mt-u-overline">CONTROL DESK</span>
      <h2>Trading Cycle</h2></div><span className="mt-u-chip">{control?.runStatus||'NOT CONFIGURED'}</span></div>
    <p className="mt-u-hint">Start/Stop mengontrol evaluasi strategi, bukan proses heartbeat. Perintah diproses worker secara berurutan.</p>
    <div className="mt-u-buttons">
      <button type="button" className="mt-u-primary" disabled={!canOperate||!engineReady||commandBusy||
        control?.runStatus==='RUNNING'} onClick={()=>void command('START')}>
        <I name="play"/> Start Cycle</button>
      <button type="button" disabled={!canOperate||commandBusy||control?.runStatus!=='RUNNING'}
        className="mt-u-secondary" onClick={()=>void command('STOP')}><I name="stop"/> Stop Cycle</button>
    </div>
    <div className="mt-u-help">{!operatorAvailable?'Operator command service belum terkonfigurasi.':
      !workerAvailable?'Worker tidak tersedia, perintah dinonaktifkan.':
      !engineReady?'Start terkunci: trusted quote, economic calendar, dan paper broker belum tersambung. MT5 Observer saja tidak mengaktifkan trading.':
      'Safety guard siap dievaluasi saat Start.'}</div>
    <div className="mt-u-preflight" aria-label="Persyaratan Start Trading demo">
      <span><I name="shield" size={12}/> Trusted quote <b>{control?.quotesReady?'READY':'WAITING'}</b></span>
      <span><I name="receipt" size={12}/> Paper broker <b>{control?.brokerReady?'READY':'WAITING'}</b></span>
      <span><I name="news" size={12}/> News calendar <b>{control?.newsCalendarReady?'READY':'WAITING'}</b></span>
    </div>
    <div className="mt-u-settings">
      <label className="mt-u-label">Jumlah Cycle</label>
      <div className="mt-u-choice">
        {(['CONTINUOUS','CUSTOM'] as const).map(value=><button key={value} type="button"
          className={cycleMode===value?'current':''} aria-pressed={cycleMode===value}
          disabled={commandBusy} onClick={()=>{setCycleMode(value);setDirty(true);}}>{value==='CONTINUOUS'?'Continuous':'Custom'}</button>)}
      </div>
      {cycleMode==='CUSTOM'&&<label className="mt-u-custom">Target evaluasi strategi
        <input type="number" min="1" max="1000000" step="1" value={target}
          disabled={commandBusy} onChange={e=>{setTarget(e.target.value);setDirty(true);}}/>
      </label>}
      <label className="mt-u-label" htmlFor="mt-u-news-policy"><I name="news" size={15}/> News Trading Policy</label>
      <select id="mt-u-news-policy" value="AVOID" disabled>
        <option value="AVOID">Locked · Avoid high-impact news ±60 minutes</option>
      </select>
      <p className="mt-u-help">Policy AVOID dikunci. Status kalender tampil pada News Safety Guard; kalender CLEAR saja tidak mengaktifkan order.</p>
      <button className="mt-u-apply" disabled={!canOperate||commandBusy||
        control?.runStatus==='RUNNING'} onClick={()=>void command('CONFIGURE')} type="button"
        title={!canOperate?'Menunggu telemetry operator yang terverifikasi':
          'Kirim ulang konfigurasi meskipun nilainya belum berubah'}>
        {working==='CONFIGURE'?'Mengirim konfigurasi…':
          commandProgress?.phase==='QUEUED'&&commandProgress.action==='CONFIGURE'
            ?'Menunggu konfirmasi worker…':
          dirty?'Save Configuration':'Save Configuration · Reapply'}</button>
    </div>
    {commandProgress&&<div className="mt-u-command-progress" data-phase={commandProgress.phase}
      role="status" aria-live="polite" aria-label="Master command progress">
      <div className="mt-u-progress-head">
        <strong>{progressText}</strong>
        <small>{commandProgress.phase==='APPLIED'?'WORKER ACKNOWLEDGED':
          commandProgress.phase==='REJECTED'?'NOT APPLIED':
          commandProgress.phase==='DELAYED'?'CHECK COMMAND HISTORY':
          commandProgress.phase==='SENDING'?'SUBMITTING':'IN PROGRESS'}</small>
      </div>
      <div className="mt-u-progress-track" role="progressbar"
        aria-label="Apply configuration progress" aria-valuetext={progressText}>
        <span className="mt-u-progress-bar"/>
      </div>
      <div className="mt-u-progress-steps">
        <span data-checked={commandProgress.phase!=='SENDING'}>01 · API received</span>
        <span data-checked={commandProgress.phase==='APPLIED'}>02 · Worker applied</span>
      </div>
      {commandProgress.phase==='DELAYED'&&<p className="mt-u-progress-note">
        Status belum dikonfirmasi. Periksa Terminal Activity sebelum mencoba lagi.
      </p>}
    </div>}
    {!!feedback&&<p className="mt-u-feedback" role="status">{feedback}</p>}
    <div className="mt-u-reset">
      <div><strong>Trial Session</strong><small>{newSession?newSession.slice(0,8)+'…':'Belum tersedia'} · {pending} command pending</small></div>
      <button type="button" disabled={!canOperate||commandBusy||control?.runStatus==='RUNNING'} onClick={()=>setConfirmReset(v=>!v)}>
        <I name="reset" size={15}/> Reset Journal</button>
    </div>
    {confirmReset&&<div className="mt-u-reset-confirm"><p>Mulai sesi baru. Riwayat order, anomaly, dan audit lama tidak dihapus. Ketik <strong>RESET</strong> untuk konfirmasi.</p>
      <input aria-label="Konfirmasi reset journal" value={confirmText} onChange={e=>setConfirmText(e.target.value)} placeholder="RESET" autoComplete="off"/>
      <button type="button" disabled={confirmText!=='RESET'||commandBusy} onClick={()=>void command('RESET_SESSION')}>Confirm New Session</button></div>}
   </section>
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
