'use client';
import type {DemoBatch} from '../../lib/demo-batch.mjs';
import { useEffect, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import './master.css';
import './master-report.css';
import FinancialOverview from './financial-overview';
import CompactDashboard from './compact-dashboard';
import DemoBatchPanel from './demo-batch-panel';
import type {EngineDiagnostics,OwnedPnl} from '../../lib/engine-diagnostics.mjs';
import type {NewsSnapshot} from '../../lib/news-calendar.mjs';

type Tab = 'dashboard'|'overview'|'cycles'|'anomalies'|'system';
type Notice = { id: string; at: string; severity: 'info'|'warning'|'critical'; kind: string; note: string };
type PaperOrder = { id: string; symbol: string; side: string; state: string; quantity: string; at: string };
export type Snapshot = {
  source: string; observedAt: string; executionMode: string;
  master: {id: string|null; state: string; heartbeatAt: string|null; cycles: number|null; healthyCycles: number|null;
           anomalies: number|null; activeSource: string|null; recoveryTicks: number|null;
           lastCycleAt?: string|null; uptimeSeconds?: number|null; reason?: string|null};
  risk: {killSwitch: string; positions: number|null; equityUsd: number|null; pnlUsd: number|null;
         drawdownPct: number|null; winRatePct: number|null};
  infrastructure: {memberApi: string; masterWorker: string; journal: string; adminAuth: string};
  activity: Notice[]; paperOrders: PaperOrder[]; equityCurve: number[];
  queue?: {queued:number;retry:number;expired:number;rejected:number;accepted:number;deadLetter:number};
  paperExecution?: {accepted:number;rejected:number;fillsVerified:boolean};
  diagnostic?: {code:string;component?:string};
  news?: NewsSnapshot;
  demoBatch?:DemoBatch|null;
  market?: {demoBatch?:DemoBatch|null;engineDiagnostics?:EngineDiagnostics;ownedPositionPnl?:OwnedPnl|null;status:'NOT_CONNECTED'|'STALE'|'VERIFIED'|'OBSERVED_READ_ONLY';source:string;
    brokerName:string|null;accountMode:'DEMO'|'REAL'|null;symbol:string|null;
    observedAt:string|null;bid:number|null;ask:number|null;pointSize:number|null;
    spreadPoints:number|null;commissionUsdPerLot:number|null;slippagePoints:number|null;
    volatilityPct:number|null;volatilityWindow:string|null;atr14:number|null;
    atrTimeframe:string|null;executionAdapter:string;atrRecomputed?:boolean;
    accountCurrency?:string|null;equity?:number|null;margin?:number|null;
    freeMargin?:number|null;marginLevelPct?:number|null;positionsCount?:number|null;
    pendingOrdersCount?:number|null;foreignExposure?:boolean|null};
  control?: {
    runStatus:'STOPPED'|'RUNNING'|'COMPLETED'|'HALTED'|'NOT_CONFIGURED';
    cycleMode:'CONTINUOUS'|'CUSTOM';targetCycles:number|null;strategyCycles:number|null;
    newsPolicy:'AVOID'|'ALLOW'|'ONLY';sessionId:string|null;lastRejection:string|null;
    operatorConfigured:boolean;quotesReady:boolean;brokerReady:boolean;newsCalendarReady:boolean;
  };
  terminal?: Array<{id:string;at:string;source:string;severity:'info'|'warning'|'critical';kind:string;message:string}>;
  commands?: Array<{id:string;requestId:string|null;action:string;status:string;errorCode:string|null;at:string|null}>;
};

const routes: {key:Tab;label:string;icon:string;caption:string}[] = [
  {key:'dashboard',label:'Dashboard',icon:'home',caption:'Unified command center'},
  {key:'overview',label:'Overview',icon:'chart',caption:'Operational summary'},
  {key:'cycles',label:'Cycle Monitor',icon:'pulse',caption:'Execution progress & cycle history'},
  {key:'anomalies',label:'Anomaly Center',icon:'alert',caption:'Risk event history'},
  {key:'system',label:'System',icon:'settings',caption:'Service connectivity'},
];
function Glyph({name,size=20}:{name:string;size?:number}) {
  const common={fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} {...common}>
    {name==='home'&&<path fill="currentColor" stroke="none" d="M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z"/>}
    {name==='chart'&&<><rect fill="currentColor" stroke="none" x="3" y="13" width="4" height="8" rx="1"/><rect fill="currentColor" stroke="none" x="10" y="8" width="4" height="13" rx="1"/><rect fill="currentColor" stroke="none" x="17" y="3" width="4" height="18" rx="1"/></>}
    {name==='settings'&&<><path d="M4 7h16M4 17h16" strokeWidth="3"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/></>}
    {name==='grid'&&<><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></>}
    {name==='pulse'&&<><path d="M20 7v5h-5M4 17v-5h5M5 9a7 7 0 0 1 12-2l3 5M4 12l3 5a7 7 0 0 0 12-2" strokeWidth="2.5"/></>}
    {name==='alert'&&<><path d="m12 3 10 18H2L12 3z"/><path d="M12 9v5m0 4h.01"/></>}
    {name==='shield'&&<><path d="m12 2 8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></>}
    {name==='receipt'&&<><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3z"/><path d="M8 8h8M8 12h8M8 16h5"/></>}
    {name==='layers'&&<><path d="m12 3 10 6-10 6L2 9l10-6z"/><path d="m2 13 10 6 10-6M2 17l10 5 10-5"/></>}
    {name==='refresh'&&<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a7 7 0 0 1 12-2l3 5M4 12l3 5a7 7 0 0 0 12-2"/></>}
    {name==='arrow'&&<path d="M5 12h14m-6-6 6 6-6 6"/>}
    {name==='lock'&&<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>}
    {name==='chevron'&&<path d="m9 18 6-6-6-6"/>}
    {name==='clock'&&<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
    {name==='logout'&&<><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9"/></>}
  </svg>;
}
function Brand() {return <div className="mt-brand">
  <img src="/brand/tradevice-arrow.svg?v=orange-20261012" width="36" height="36" alt="" aria-hidden="true"/>
  <span><strong>tradevice<span className="mt-dot">.</span></strong><small>MASTER CONTROL</small></span>
</div>;}
function Value({value,suffix=''}:{value:number|null|undefined;suffix?:string}) {
  return <>{typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2})+suffix:'—'}</>;
}
function Pill({value}:{value:string}) {
  const safe=['ACTIVE','ONLINE','READY','VERIFIED','DISENGAGED'].includes(value);
  const bad=['DEGRADED','HALTED','SAFETY_MISMATCH','CRITICAL'].includes(value);
  return <span className={'mt-pill '+(safe?'mt-pill-good':bad?'mt-pill-bad':'mt-pill-muted')}><i/>{value.replaceAll('_',' ')}</span>;
}
function Graph({numbers}:{numbers:number[]}) {
  if(numbers.length<2)return <div className="mt-graph-empty"><Glyph name="pulse" size={27}/><strong>Belum ada data equity master</strong><p>Belum ada hasil paper trading terverifikasi. Grafik akan terisi dari data eksekusi yang sah.</p></div>;
  const width=740,height=205,pad=20,min=Math.min(...numbers)-7,max=Math.max(...numbers)+7;
  const pts=numbers.map((v,i)=>({x:pad+i/(numbers.length-1)*(width-pad*2),y:height-pad-(v-min)/(max-min)*(height-pad*2)}));
  const line=pts.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
  const area=pts[0].x+','+(height-pad)+' '+line+' '+pts[pts.length-1].x+','+(height-pad);
  return <svg className="mt-graph" viewBox={'0 0 '+width+' '+height} role="img" aria-label="Grafik equity dari eksekusi paper yang telah diverifikasi">
    {[44,93,142,191].map(y=><line key={y} x1={pad} y1={y} x2={width-pad} y2={y} stroke="#2e2e2e" strokeDasharray="3 7"/>)}
    <polyline points={area} fill="#ff7900" fillOpacity=".07"/>
    <polyline points={line} fill="none" stroke="#ff7900" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="5" fill="#ffb064" stroke="#3a210e" strokeWidth="5"/>
  </svg>;
}
function Metric({label,children,desc,icon}:{label:string;children:React.ReactNode;desc:string;icon:string}){
  return <div className="mt-metric"><div className="mt-metric-top"><span>{label}</span><Glyph name={icon} size={17}/></div>
    <strong>{children}</strong></div>;
}
function Events({rows}:{rows:Notice[]}) {
  return rows.length?<div className="mt-table-scroll"><table className="mt-table">
    <thead><tr><th>Event</th><th>Type</th><th>Time</th><th>Details</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.id}><td className="mt-event-id">{row.id}</td>
      <td><span className={'mt-severity '+row.severity}>{row.severity.toUpperCase()}</span> {row.kind}</td>
      <td>{row.at}</td><td className="mt-faint">{row.note}</td></tr>)}</tbody>
  </table></div>:<div className="mt-empty-small">Belum ada event master yang terhubung.</div>;
}
function Orders({rows}:{rows:PaperOrder[]}) {
  return rows.length?<div className="mt-table-scroll"><table className="mt-table">
    <thead><tr><th>Order ID</th><th>Symbol</th><th>Side</th><th>Lots</th><th>Paper status</th><th>Time</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.id}><td className="mt-event-id">{row.id}</td><td><strong>{row.symbol}</strong></td>
      <td>{row.side}</td><td>{row.quantity}</td><td><Pill value={row.state}/></td><td>{row.at}</td></tr>)}</tbody>
  </table></div>:<div className="mt-empty-small">Tidak ada order paper yang dapat diverifikasi. Journal worker belum terhubung.</div>;
}
function SectionHead({eyebrow,title,extra}:{eyebrow:string;title:string;extra?:React.ReactNode}){
  return <div className="mt-section-head"><div><small>{eyebrow}</small><h2>{title}</h2></div>{extra}</div>;
}
export default function MasterConsole() {
  const [tab,setTab]=useState<Tab>('dashboard');
  const [auth,setAuth]=useState<'loading'|'login'|'checking'|'authorized'|'forbidden'>('loading');
  const [client,setClient]=useState<SupabaseClient|null>(null);
  const [token,setToken]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [refreshIndex,setRefreshIndex]=useState(0);
  const [severity,setSeverity]=useState<'all'|'warning'|'critical'>('all');
  useEffect(()=>{
    let mounted=true;
    let subscription:{unsubscribe:()=>void}|null=null;
    async function boot(){
      try{
        const r=await fetch('/api/runtime',{cache:'no-store'});
        if(!r.ok)throw new Error('Runtime unavailable');
        const config=await r.json();
        if(!config.configured || !config.supabaseUrl || !config.publishableKey)throw new Error('Auth unavailable');
        const authClient=createClient(config.supabaseUrl,config.publishableKey,{
          auth:{storageKey:'tradevice-master-console-staging',autoRefreshToken:true,persistSession:true,detectSessionInUrl:false},
        });
        if(!mounted)return;
        setClient(authClient);
        const {data:{subscription:s}}=authClient.auth.onAuthStateChange((_event,session)=>{
          if(mounted)setToken(session?.access_token||'');
        });
        subscription=s;
        const {data:{session}}=await authClient.auth.getSession();
        if(mounted){setToken(session?.access_token||'');setAuth(session?'checking':'login');}
      }catch{
        if(mounted){setAuth('forbidden');setMessage('Konfigurasi autentikasi staging belum tersedia.');}
      }
    }
    void boot();
    return()=>{mounted=false;subscription?.unsubscribe();};
  },[]);
  useEffect(()=>{
    if(!token){setSnapshot(null);setAuth(v=>v==='loading'?'loading':'login');return;}
    let active=true;
    let loading=false;
    async function load(){
      if(loading)return;
      loading=true;
      try{
        const response=await fetch('/api/master/overview',{
          headers:{Authorization:'Bearer '+token},cache:'no-store',
        });
        if(!active)return;
        if(response.status===401){setAuth('login');setSnapshot(null);setMessage('Sesi kedaluwarsa, silakan masuk lagi.');return;}
        if(response.status===403){setAuth('forbidden');setSnapshot(null);setMessage('Akses Master Trader hanya untuk administrator yang telah disetujui.');return;}
        if(!response.ok)throw new Error('Service unavailable');
        const data=await response.json() as Snapshot;
        if(!['STAGING_INFRASTRUCTURE','STAGING_WORKER_TELEMETRY'].includes(data.source) || data.executionMode!=='PAPER_ONLY')throw new Error('Invalid mode');
        setSnapshot(data);setAuth('authorized');setMessage('');
      }catch{
        if(active){
          // A temporary telemetry/network failure does not invalidate verified admin auth.
          // Clear all market/control data to fail closed while retaining the console shell.
          setSnapshot(null);
          setAuth(current=>current==='authorized'?current:'forbidden');
          setMessage('Koneksi monitoring sementara tidak tersedia. Periksa System Health dan coba refresh.');
        }
      }finally{loading=false;}
    }
    // A successful admin session stays mounted during revalidation.
    // A command acknowledgement or refreshed JWT must not bounce to login.
    // Explicit 401/403 responses above still immediately revoke dashboard access.
    setAuth(current=>current==='authorized'?current:'checking');
    void load();
    const id=window.setInterval(()=>{void load();},5000);
    return()=>{active=false;window.clearInterval(id);};
  },[token,refreshIndex]);
  async function signIn(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!client)return;
    setBusy(true);setMessage('');
    try{
      const {error}=await client.auth.signInWithPassword({email,password});
      if(error){setMessage('Login gagal. Periksa kredensial dan izin administrator.');setAuth('login');}
      else{setAuth('checking');}
    }catch{setMessage('Layanan autentikasi belum dapat diakses.');}
    finally{setPassword('');setBusy(false);}
  }
  async function signOut(){
    setToken('');setSnapshot(null);setAuth('login');
    if(client)await client.auth.signOut();
  }
  const data:Snapshot|null=snapshot;
  const mode=data?.master.state||'NOT_CONNECTED';
  const workerOnline=data?.infrastructure.masterWorker==='ONLINE';
  const alertRows=(data?.activity||[]).filter(row=>severity==='all'||row.severity===severity);
  const roleTitle=routes.find(route=>route.key===tab)?.label||'Overview';

  if(auth!=='authorized')return <main className="mt mt-login">
    <div className="mt-login-card"><Brand/><div className="mt-login-line"/>
      <div className="mt-eyebrow">PRIVATE OPERATOR CONSOLE / STAGING</div>
      <h1>Master Trader<br/><span>Control Center.</span></h1>
      <p>Area operasional terpisah dari dashboard member. Hanya akun Supabase dengan izin master admin yang dapat mengakses informasi internal.</p>
      {auth==='checking'||auth==='loading'?<div className="mt-login-wait"><span className="mt-spinner"/>Memverifikasi sesi administrator...</div>:
      <form onSubmit={signIn} className="mt-login-form">
        <label htmlFor="mt-email">Email administrator</label>
        <input id="mt-email" type="email" autoComplete="username" placeholder="admin@company.com" value={email} required onChange={e=>setEmail(e.target.value)}/>
        <label htmlFor="mt-password">Password</label>
        <input id="mt-password" type="password" autoComplete="current-password" placeholder="Password" value={password} required onChange={e=>setPassword(e.target.value)}/>
        {message&&<p role="alert" className="mt-login-error">{message}</p>}
        <button type="submit" className="mt-primary" disabled={busy||!client}>{busy?'Memverifikasi...':'Masuk sebagai admin'} <Glyph name="arrow" size={18}/></button>
      </form>}
      <div className="mt-login-foot"><span><Glyph name="lock" size={16}/> Server-verified role</span><span>Staging · paper only</span></div>
    </div>
    <div className="mt-login-art"><div className="mt-art-grid"/><div className="mt-art-glow"/><div className="mt-art-top">TRADEVICE / OPERATIONS</div>
      <div className="mt-art-value">01<span> / MASTER</span></div><div className="mt-art-bottom">Continuity first.<br/>Execution only when safe.</div>
      <div className="mt-art-meta">PAPER ONLY <span>•</span> STAGING ENVIRONMENT</div>
    </div>
  </main>;

  return <div className="mt mt-shell">
    <a className="mt-skip" href="#mt-main">Langsung ke konten</a>
    <aside className="mt-sidebar"><a href="/master" aria-label="Master Trader Control Center"><Brand/></a>
      <div className="mt-sidebar-divider"/>
      <div className="mt-side-caption">WORKSPACE</div>
      <nav className="mt-side-nav" aria-label="Master desktop navigation">{routes.map(route=><button key={route.key} type="button" onClick={()=>setTab(route.key)} className={tab===route.key?'current':''} aria-current={tab===route.key?'page':undefined}>
        <Glyph name={route.icon}/><span>{route.label}</span>{tab===route.key&&<span className="mt-nav-dot"/>}</button>)}</nav>
      <div className="mt-sidebar-bottom"><div className="mt-sidebar-guard"><Glyph name="shield" size={22}/><div><strong>Paper execution only</strong><p>Live orders &amp; funding locked</p></div></div>
      <a className="mt-side-member" href="/">Member portal <Glyph name="arrow" size={16}/></a></div>
    </aside>
    <div className="mt-workspace">
      <header className="mt-topbar">
        <div className="mt-mobile-brand"><Brand/></div>
        <div className="mt-top-crumb"><span>MASTER TRADER</span><Glyph name="chevron" size={14}/><strong>{roleTitle}</strong></div>
        <div className="mt-top-actions"><span className="mt-env-tag">STAGING</span>
          <button type="button" className="mt-refresh" aria-label="Refresh master status" onClick={()=>setRefreshIndex(i=>i+1)}><Glyph name="refresh" size={18}/></button>
          <button type="button" className="mt-logout" onClick={()=>void signOut()} aria-label="Keluar master admin"><Glyph name="logout" size={18}/></button></div>
      </header>
      <main id="mt-main" className="mt-main mt-report">
        <div className="mt-page-header"><h1>{roleTitle}</h1></div>
        {message&&auth==='authorized'&&!data&&<div role="alert" className="mt-disclosure">
          <Glyph name="alert" size={20}/><div><strong>TELEMETRY TEMPORARILY UNAVAILABLE</strong>
            <span>{message} Semua kontrol trading dinonaktifkan sampai koneksi pulih.</span></div>
        </div>}
        {tab==='dashboard'&&<CompactDashboard data={data} token={token} onNavigate={setTab}
            onUpdated={()=>setRefreshIndex(i=>i+1)}/>}
        {tab==='overview'&&<>
          <FinancialOverview data={data}/>
          <section className="mt-panel mt-performance"><SectionHead eyebrow="PAPER PERFORMANCE" title="Verified paper equity curve" extra={<Pill value={data?.equityCurve.length ? "VERIFIED" : "NO DATA"}/>}/>
            <Graph numbers={data?.equityCurve||[]}/>

          </section>
        </>}
        {tab==='cycles'&&<>
          <DemoBatchPanel raw={data?.demoBatch??data?.market?.demoBatch} cycleOnly/>
          <section className="mt-panel"><SectionHead eyebrow="MASTER ENGINE" title="Supervisor continuity" extra={<Pill value={mode}/>}/>
            <div className="mt-state-flow">{[
              ['01','MARKET DATA','Source quality and freshness'],
              ['02','ANOMALY GATE','Reject unsafe decisions'],
              ['03','RECOVERY','3 clean ticks + cooldown'],
              ['04','PAPER INBOX','Idempotent accepted simulation'],
            ].map(step=><div className="mt-state-step" key={step[0]}><small>{step[0]}</small><strong>{step[1]}</strong></div>)}</div>

          </section>
          <div className="mt-runtime-row">
            <div><small>LAST SUPERVISOR TICK</small><strong>{data?.master.lastCycleAt||'NOT MEASURED'}</strong></div>
            <div><small>RUNTIME UPTIME</small><strong>{typeof data?.master.uptimeSeconds==='number'?Math.floor(data.master.uptimeSeconds/60)+' min':'NOT MEASURED'}</strong></div>
            <div><small>ACTIVE DATA SOURCE</small><strong>{data?.master.activeSource||'NONE · ORDERS BLOCKED'}</strong></div>
            <div><small>PENDING SIGNALS</small><strong>{typeof data?.queue?.queued==='number'?data.queue.queued+data.queue.retry:'NOT MEASURED'}</strong></div>
          </div>
          <div className="mt-metrics mt-three"><Metric icon="pulse" label="Supervisor ticks" desc="Monitoring iterations, not trading cycles"><Value value={data?.master.cycles}/></Metric>
            <Metric icon="alert" label="Anomaly count" desc="Observed quality failures"><Value value={data?.master.anomalies}/></Metric>
            <Metric icon="shield" label="Recovery ticks" desc="Consecutive clean observations"><Value value={data?.master.recoveryTicks}/></Metric></div>
        </>}
        {tab==='anomalies'&&<section className="mt-panel"><SectionHead eyebrow="EXCEPTIONS & RECOVERY" title="Anomaly event log" extra={<Pill value={mode}/>}/>
          <div className="mt-filter" aria-label="Filter anomaly severity">{(['all','warning','critical'] as const).map(v=><button key={v} type="button" aria-pressed={severity===v} onClick={()=>setSeverity(v)} className={severity===v?'current':''}>{v==='all'?'All events':v==='warning'?'Warning':'Critical'}</button>)}</div><Events rows={alertRows}/>
          </section>}
        {tab==='system'&&<>
          <div className="mt-risk-grid"><section className="mt-panel"><SectionHead eyebrow="EXECUTION GUARDRAILS" title="Risk controls"/>
            {[
              ['Trading mode','PAPER ONLY'],
              ['Live execution','DISABLED'],
              ['Deposit / withdrawal','DISABLED'],
              ['Master kill switch',data?.risk.killSwitch||'NOT_CONNECTED'],
              ['Order replay guard',workerOnline?'WORKER GUARDED':'WORKER NOT CONNECTED'],
            ].map(([label,value])=><div className="mt-risk-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </section><section className="mt-panel mt-safety"><div className="mt-safety-icon"><Glyph name="lock" size={28}/></div>
            <h2>Emergency kill switch</h2>
            <button type="button" disabled className="mt-kill-disabled">Kill switch unavailable <Glyph name="lock" size={18}/></button>

          </section></div>
          <div className="mt-metrics mt-three"><Metric icon="shield" label="Drawdown" desc="Requires verified closed paper fills"><Value value={data?.risk.drawdownPct} suffix="%"/></Metric><Metric icon="pulse" label="Open positions" desc="Requires reconciliation"><Value value={data?.risk.positions}/></Metric><Metric icon="receipt" label="Net paper P&L" desc="Requires verified paper execution">{typeof data?.risk.pnlUsd==='number'?'$'+data.risk.pnlUsd.toFixed(2):'—'}</Metric></div>
        </>}
        {tab==='system'&&<section className="mt-panel"><SectionHead eyebrow="PAPER EXECUTION AUDIT" title="Paper order journal" extra={<Pill value={data?.paperOrders.length ? "PAPER" : "NO ORDERS"}/>}/>

          <div className="mt-journal-summary">
            <span>Accepted paper acknowledgements: <strong>{data?.queue?.accepted??'—'}</strong></span>
            <span>Rejected paper signals: <strong>{data?.queue?.rejected??'—'}</strong></span>
            <span>Verified fills: <strong>NOT MEASURED</strong></span>
          </div>
          <Orders rows={data?.paperOrders||[]}/></section>}
        {tab==='system'&&<>
          <section className="mt-panel"><SectionHead eyebrow="INFRASTRUCTURE" title="Connectivity & data provenance"/><div className="mt-system-grid">
            {[
              ['Member API',data?.infrastructure.memberApi||'UNKNOWN','Railway staging health'],
              ['Master worker',data?.infrastructure.masterWorker||'OFFLINE/STALE','Database-backed staging heartbeat'],
              ['Master journal',data?.infrastructure.journal||'UNAVAILABLE','Read-only Postgres staging journal'],
              ['Admin authorization',data?.infrastructure.adminAuth||'NOT_CONFIGURED','Supabase app_metadata gate'],
            ].map(([label,value,note])=><div key={label} className="mt-system-card"><div className="mt-system-card-top"><Glyph name="layers" size={19}/><Pill value={value}/></div><h3>{label}</h3></div>)}
          </div></section>
        </>}
        <footer className="mt-footer"><span>TRADEVICE / MASTER CONTROL CENTER</span><span>STAGING</span></footer>
      </main>
    </div>
    <nav className="mt-mobile-nav" data-active={tab} aria-label="Master mobile navigation">{routes.map(route=><button type="button" key={route.key} onClick={()=>setTab(route.key)} className={tab===route.key?'current':''} aria-label={route.label} aria-current={tab===route.key?'page':undefined}><Glyph name={route.icon} size={19}/><span>{route.label.split(' ')[0]}</span></button>)}</nav>
  </div>;
}
