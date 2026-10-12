'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import './master.css';

type Tab = 'overview'|'cycles'|'anomalies'|'risk'|'journal'|'system';
type Scenario = 'healthy'|'anomaly'|'recovering';
type Notice = { id: string; at: string; severity: 'info'|'warning'|'critical'; kind: string; note: string };
type PaperOrder = { id: string; symbol: string; side: 'BUY'|'SELL'; state: string; quantity: string; at: string };
type Snapshot = {
  source: string; observedAt: string; executionMode: string;
  master: {id: string|null; state: string; heartbeatAt: string|null; cycles: number|null; healthyCycles: number|null;
           anomalies: number|null; activeSource: string|null; recoveryTicks: number|null};
  risk: {killSwitch: string; positions: number|null; equityUsd: number|null; pnlUsd: number|null;
         drawdownPct: number|null; winRatePct: number|null};
  infrastructure: {memberApi: string; masterWorker: string; journal: string; adminAuth: string};
  activity: Notice[]; paperOrders: PaperOrder[]; equityCurve: number[];
};

const routes: {key:Tab;label:string;icon:string;caption:string}[] = [
  {key:'overview',label:'Overview',icon:'grid',caption:'Operational summary'},
  {key:'cycles',label:'Cycle Monitor',icon:'pulse',caption:'Heartbeat & recovery'},
  {key:'anomalies',label:'Anomaly Center',icon:'alert',caption:'Risk event history'},
  {key:'risk',label:'Risk & Safety',icon:'shield',caption:'Safety guardrails'},
  {key:'journal',label:'Paper Journal',icon:'receipt',caption:'Simulated order records'},
  {key:'system',label:'System Health',icon:'layers',caption:'Service connectivity'},
];
const chartValues = [1000,1006,1004,1010,1007,1015,1013,1022,1018,1028,1025,1032,1028,1038,1032,1043,1041,1052,1048,1058];
const demoEvents: Notice[] = [
  {id:'EV-008',at:'09:02:24',severity:'info',kind:'Recovery confirmed',note:'Three clean observations; paper admission restored'},
  {id:'EV-007',at:'09:02:20',severity:'warning',kind:'Quote stale',note:'Old quote rejected, supervisory heartbeat continued'},
  {id:'EV-006',at:'09:02:18',severity:'critical',kind:'Spread guard',note:'Spread above configured threshold; no new order admitted'},
  {id:'EV-005',at:'09:01:47',severity:'info',kind:'Paper order accepted',note:'Journal acknowledgement only, not an executed fill'},
  {id:'EV-004',at:'09:00:12',severity:'warning',kind:'Duplicate signal',note:'Replay ignored through idempotency key'},
];
const demoOrders: PaperOrder[] = [
  {id:'SIM-2008',symbol:'XAUUSD',side:'BUY',state:'ACCEPTED_SIMULATED',quantity:'0.01',at:'09:01:47'},
  {id:'SIM-2007',symbol:'XAUUSD',side:'SELL',state:'EXPIRED',quantity:'0.02',at:'08:58:21'},
  {id:'SIM-2006',symbol:'XAUUSD',side:'BUY',state:'REJECTED',quantity:'0.01',at:'08:56:10'},
  {id:'SIM-2005',symbol:'XAUUSD',side:'BUY',state:'ACCEPTED_SIMULATED',quantity:'0.01',at:'08:51:08'},
];
function demoData(scenario:Scenario): Snapshot {
  const changed = scenario==='anomaly', recovering=scenario==='recovering';
  return {
    source:'SYNTHETIC_PREVIEW', observedAt:'2026-10-12T02:00:00Z', executionMode:'PAPER_ONLY',
    master:{ id:'MASTER-PAPER-01',state:changed?'DEGRADED':recovering?'RECOVERING':'ACTIVE',
      heartbeatAt:'2026-10-12T02:00:00Z',cycles:1248,healthyCycles:1235,anomalies:13,
      activeSource:'primary',recoveryTicks:changed?0:recovering?2:3},
    risk:{killSwitch:'DISENGAGED',positions:2,equityUsd:1058,pnlUsd:58,drawdownPct:1.24,winRatePct:62.5},
    infrastructure:{memberApi:'ONLINE',masterWorker:'SYNTHETIC',journal:'SYNTHETIC',adminAuth:'PREVIEW_ONLY'},
    activity:changed?[
      {id:'EV-009',at:'09:03:01',severity:'critical',kind:'Feed stale · DEGRADED',note:'Paper order admission paused; heartbeat stays alive'},
      ...demoEvents,
    ]:recovering?[
      {id:'EV-009',at:'09:03:03',severity:'warning',kind:'Recovery checkpoint 2/3',note:'New orders held until additional clean observation'},
      ...demoEvents,
    ]:demoEvents,
    paperOrders:demoOrders,equityCurve:chartValues,
  };
}
function Glyph({name,size=20}:{name:string;size?:number}) {
  const common={fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} {...common}>
    {name==='grid'&&<><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></>}
    {name==='pulse'&&<path d="M2 12h5l3-8 4 16 3-8h5"/>}
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
  if(numbers.length<2)return <div className="mt-graph-empty"><Glyph name="pulse" size={27}/><strong>Belum ada data equity master</strong><p>Master worker dan journal belum terhubung. Tidak ada P&amp;L yang dapat diverifikasi.</p></div>;
  const width=740,height=205,pad=20,min=Math.min(...numbers)-7,max=Math.max(...numbers)+7;
  const pts=numbers.map((v,i)=>({x:pad+i/(numbers.length-1)*(width-pad*2),y:height-pad-(v-min)/(max-min)*(height-pad*2)}));
  const line=pts.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
  const area=pts[0].x+','+(height-pad)+' '+line+' '+pts[pts.length-1].x+','+(height-pad);
  return <svg className="mt-graph" viewBox={'0 0 '+width+' '+height} role="img" aria-label="Grafik equity dari data sintetis, bukan performa trading aktual">
    {[44,93,142,191].map(y=><line key={y} x1={pad} y1={y} x2={width-pad} y2={y} stroke="#2e2e2e" strokeDasharray="3 7"/>)}
    <polyline points={area} fill="#ff7900" fillOpacity=".07"/>
    <polyline points={line} fill="none" stroke="#ff7900" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="5" fill="#ffb064" stroke="#3a210e" strokeWidth="5"/>
  </svg>;
}
function Metric({label,children,desc,icon}:{label:string;children:React.ReactNode;desc:string;icon:string}){
  return <div className="mt-metric"><div className="mt-metric-top"><span>{label}</span><Glyph name={icon} size={17}/></div>
    <strong>{children}</strong><small>{desc}</small></div>;
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
export default function MasterConsole({preview=false}:{preview?:boolean}) {
  const [tab,setTab]=useState<Tab>('overview');
  const [scenario,setScenario]=useState<Scenario>('healthy');
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
    if(preview)return;
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
  },[preview]);
  useEffect(()=>{
    if(preview)return;
    if(!token){setSnapshot(null);setAuth(v=>v==='loading'?'loading':'login');return;}
    let active=true;
    async function load(){
      try{
        const response=await fetch('/api/master/overview',{
          headers:{Authorization:'Bearer '+token},cache:'no-store',
        });
        if(!active)return;
        if(response.status===401){setAuth('login');setSnapshot(null);setMessage('Sesi kedaluwarsa, silakan masuk lagi.');return;}
        if(response.status===403){setAuth('forbidden');setSnapshot(null);setMessage('Akses Master Trader hanya untuk administrator yang telah disetujui.');return;}
        if(!response.ok)throw new Error('Service unavailable');
        const data=await response.json() as Snapshot;
        if(data.source!=='STAGING_INFRASTRUCTURE' || data.executionMode!=='PAPER_ONLY')throw new Error('Invalid mode');
        setSnapshot(data);setAuth('authorized');setMessage('');
      }catch{
        if(active){setAuth('forbidden');setSnapshot(null);setMessage('Koneksi monitoring sedang tidak tersedia.');}
      }
    }
    setAuth('checking');void load();
    const id=window.setInterval(()=>{void load();},15000);
    return()=>{active=false;window.clearInterval(id);};
  },[preview,token,refreshIndex]);
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
  const data:Snapshot|null=preview?demoData(scenario):snapshot;
  const mode=data?.master.state||'NOT_CONNECTED';
  const available=!!data;
  const alertRows=(data?.activity||[]).filter(row=>severity==='all'||row.severity===severity);
  const roleTitle=routes.find(route=>route.key===tab)?.label||'Overview';

  if(!preview && auth!=='authorized')return <main className="mt mt-login">
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
      <div className="mt-login-foot"><span><Glyph name="lock" size={16}/> Server-verified role</span><a href="/master/preview">Lihat preview sintetis <Glyph name="chevron" size={16}/></a></div>
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
        <div className="mt-top-actions"><span className="mt-env-tag">STAGING</span><span className="mt-env-paper"><i/> PAPER ONLY</span>
          {!preview?<button type="button" className="mt-refresh" aria-label="Refresh master status" onClick={()=>setRefreshIndex(i=>i+1)}><Glyph name="refresh" size={18}/></button>:null}
          {!preview?<button type="button" className="mt-logout" onClick={()=>void signOut()} aria-label="Keluar master admin"><Glyph name="logout" size={18}/></button>:<a className="mt-preview-login" href="/master">Admin login <Glyph name="arrow" size={16}/></a>}</div>
      </header>
      <main id="mt-main" className="mt-main">
        <div className="mt-page-header"><div><div className="mt-eyebrow">TRADEVICE / COMMAND DESK</div>
          <h1>{tab==='overview'?'Master overview':roleTitle}<span>.</span></h1>
          <p>Monitor continuity, anomaly, risk guardrails, dan audit paper trading dari satu tempat.</p>
        </div><div className="mt-date"><Glyph name="clock" size={18}/><span>{preview?'Preview snapshot · synthetic':'Live infrastructure check · every 15s'}</span></div></div>
        <div role="note" className={'mt-disclosure '+(preview?'mt-disclosure-preview':'')}>
          <Glyph name={preview?'alert':'shield'} size={20}/>
          <div><strong>{preview?'SYNTHETIC PREVIEW · BUKAN DATA TRADING NYATA':'READ-ONLY STAGING · MASTER WORKER BELUM TERHUBUNG'}</strong>
          <span>{preview?'Angka, grafik, event, dan order di halaman ini hanya ilustrasi interaktif. Tidak ada order yang dikirim.':'Dashboard telah dilindungi login admin. Data cycle, journal dan P&L tetap tidak tersedia sampai worker resmi terhubung.'}</span></div>
        </div>
        {preview&&<div className="mt-preview-controls" aria-label="Synthetic anomaly scenarios"><span>SIMULATE CONDITIONS</span>
          {([{key:'healthy',label:'Normal'},{key:'anomaly',label:'Feed stale'},{key:'recovering',label:'Recovering'}] as const).map(item=>
            <button type="button" key={item.key} onClick={()=>setScenario(item.key)} aria-pressed={scenario===item.key} className={scenario===item.key?'current':''}>{item.label}</button>)}
        </div>}
        {tab==='overview'&&<>
          <section className="mt-hero">
            <div className="mt-hero-main"><div className="mt-hero-overline"><span className="mt-led"/> MASTER TRADER / SUPERVISOR</div>
              <h2>{mode==='ACTIVE'?'Cycle running normally.':mode==='DEGRADED'?'Anomaly detected. Cycle protected.':mode==='RECOVERING'?'Revalidating market conditions.':'Engine connection pending.'}</h2>
              <p>{preview?'Simulated master stays observable during feed disruption while new paper orders are paused.':'The Python supervisor is not deployed as a managed staging worker. Live cycle metrics are not yet connected.'}</p>
              <div className="mt-hero-foot"><Pill value={mode}/><span>Master ID: {data?.master.id||'Not connected'}</span><span>Quote feed: {data?.master.activeSource||'Not connected'}</span></div>
            </div>
            <div className="mt-hero-orbit" aria-hidden="true"><span className="mt-orbit-one"/><span className="mt-orbit-two"/><span className="mt-orbit-center"><Glyph name="pulse" size={33}/></span></div>
          </section>
          <div className="mt-metrics">
            <Metric label="Master heartbeat" icon="pulse" desc={preview?'Synthetic heartbeat':'Worker connection required'}>{data?.master.heartbeatAt?'CONNECTED':'NOT CONNECTED'}</Metric>
            <Metric label="Cycle count" icon="refresh" desc={preview?'Illustrative cycle counter':'No verified worker events'}><Value value={data?.master.cycles}/></Metric>
            <Metric label="Paper positions" icon="receipt" desc={preview?'Simulated journal only':'No worker order reconciliation'}><Value value={data?.risk.positions}/></Metric>
            <Metric label="Maximum drawdown" icon="shield" desc={preview?'Synthetic realised simulation':'No verified fills / equity'}><Value value={data?.risk.drawdownPct} suffix="%"/></Metric>
          </div>
          <div className="mt-main-grid">
            <section className="mt-panel mt-performance"><SectionHead eyebrow="PERFORMANCE MONITOR" title="Master equity curve" extra={<Pill value={preview?'SYNTHETIC':'NO DATA'}/>}/>
              <Graph numbers={data?.equityCurve||[]}/><div className="mt-performance-foot"><span>Equity: {typeof data?.risk.equityUsd==='number'?'$'+data.risk.equityUsd.toFixed(2):'Not measured'}</span><span>Win rate: {typeof data?.risk.winRatePct==='number'?data.risk.winRatePct+'%':'Not measured'}</span></div>
            </section>
            <section className="mt-panel mt-cycle-card"><SectionHead eyebrow="ENGINE CONTINUITY" title="Cycle integrity"/>
              <div className="mt-cycle-icon"><Glyph name="pulse" size={26}/></div>
              <div className="mt-cycle-stats"><span>Mode</span><Pill value={mode}/></div>
              <div className="mt-cycle-stats"><span>Confirmed clean ticks</span><strong>{data?.master.recoveryTicks??'—'} / 3</strong></div>
              <div className="mt-cycle-stats"><span>Anomaly events</span><strong><Value value={data?.master.anomalies}/></strong></div>
              <div className="mt-cycle-stats"><span>Heartbeat cycles</span><strong><Value value={data?.master.cycles}/></strong></div>
              <div className="mt-note">Anomaly ≠ process stop. Unsafe market conditions pause order admission, not the supervision loop.</div>
            </section>
          </div>
          <section className="mt-panel mt-event-panel"><SectionHead eyebrow="SAFETY & CONTINUITY" title="Latest anomaly events" extra={<button type="button" className="mt-inline-action" onClick={()=>setTab('anomalies')}>View all <Glyph name="arrow" size={15}/></button>}/><Events rows={(data?.activity||[]).slice(0,4)}/></section>
        </>}
        {tab==='cycles'&&<>
          <section className="mt-panel"><SectionHead eyebrow="MASTER ENGINE" title="Cycle continuity state machine" extra={<Pill value={mode}/>}/>
            <div className="mt-state-flow">{[
              ['01','MARKET DATA','Source quality and freshness'],
              ['02','ANOMALY GATE','Reject unsafe decisions'],
              ['03','RECOVERY','3 clean ticks + cooldown'],
              ['04','PAPER INBOX','Idempotent accepted simulation'],
            ].map(step=><div className="mt-state-step" key={step[0]}><small>{step[0]}</small><strong>{step[1]}</strong><p>{step[2]}</p></div>)}</div>
            <div className="mt-explainer"><strong>Fail-closed continuity</strong><p>The heartbeat can continue in DEGRADED or RECOVERING. No new order is admitted until every risk check passes. HALTED always requires explicit operator release.</p></div>
          </section>
          <div className="mt-metrics mt-three"><Metric icon="pulse" label="Cycle count" desc="Persisted supervisor ticks"><Value value={data?.master.cycles}/></Metric>
            <Metric icon="alert" label="Anomaly count" desc="Observed quality failures"><Value value={data?.master.anomalies}/></Metric>
            <Metric icon="shield" label="Recovery ticks" desc="Consecutive clean observations"><Value value={data?.master.recoveryTicks}/></Metric></div>
        </>}
        {tab==='anomalies'&&<section className="mt-panel"><SectionHead eyebrow="EXCEPTIONS & RECOVERY" title="Anomaly event log" extra={<Pill value={mode}/>}/>
          <div className="mt-filter" aria-label="Filter anomaly severity">{(['all','warning','critical'] as const).map(v=><button key={v} type="button" aria-pressed={severity===v} onClick={()=>setSeverity(v)} className={severity===v?'current':''}>{v==='all'?'All events':v==='warning'?'Warning':'Critical'}</button>)}</div><Events rows={alertRows}/>
          <p className="mt-panel-caption">No external quote source or live event history is connected in operational mode.</p></section>}
        {tab==='risk'&&<>
          <div className="mt-risk-grid"><section className="mt-panel"><SectionHead eyebrow="EXECUTION GUARDRAILS" title="Risk controls"/>
            {[
              ['Trading mode','PAPER ONLY'],
              ['Live execution','DISABLED'],
              ['Deposit / withdrawal','DISABLED'],
              ['Master kill switch',data?.risk.killSwitch||'NOT_CONNECTED'],
              ['Order replay guard',preview?'ENABLED (synthetic)':'WORKER NOT CONNECTED'],
            ].map(([label,value])=><div className="mt-risk-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </section><section className="mt-panel mt-safety"><div className="mt-safety-icon"><Glyph name="lock" size={28}/></div>
            <h2>Emergency kill switch</h2><p>Kontrol ini hanya dapat diaktifkan setelah worker master yang terautentikasi dan jalur auditnya selesai terintegrasi.</p>
            <button type="button" disabled className="mt-kill-disabled">Kill switch unavailable <Glyph name="lock" size={18}/></button>
            <div className="mt-safety-note">No write command is exposed from this dashboard.</div>
          </section></div>
          <div className="mt-metrics mt-three"><Metric icon="shield" label="Drawdown" desc="Requires verified closed paper fills"><Value value={data?.risk.drawdownPct} suffix="%"/></Metric><Metric icon="pulse" label="Open positions" desc="Requires reconciliation"><Value value={data?.risk.positions}/></Metric><Metric icon="receipt" label="Net paper P&L" desc="Simulated sample only in preview">{typeof data?.risk.pnlUsd==='number'?'$'+data.risk.pnlUsd.toFixed(2):'—'}</Metric></div>
        </>}
        {tab==='journal'&&<section className="mt-panel"><SectionHead eyebrow="PAPER EXECUTION AUDIT" title="Paper order journal" extra={<Pill value={preview?'SYNTHETIC':'NOT_CONNECTED'}/>}/>
          <p className="mt-panel-caption">Accepted simulated orders are acknowledgements, not guaranteed fills. Live trading is not enabled.</p><Orders rows={data?.paperOrders||[]}/></section>}
        {tab==='system'&&<>
          <section className="mt-panel"><SectionHead eyebrow="INFRASTRUCTURE" title="Connectivity & data provenance"/><div className="mt-system-grid">
            {[
              ['Member API',data?.infrastructure.memberApi||'UNKNOWN','Railway staging health'],
              ['Master worker',data?.infrastructure.masterWorker||'NOT_DEPLOYED','No dedicated cycle worker deployed'],
              ['Master journal',data?.infrastructure.journal||'NOT_CONNECTED','No durable worker journal source'],
              ['Admin authorization',data?.infrastructure.adminAuth||'NOT_CONFIGURED','Supabase app_metadata gate'],
            ].map(([label,value,note])=><div key={label} className="mt-system-card"><div className="mt-system-card-top"><Glyph name="layers" size={19}/><Pill value={value}/></div><h3>{label}</h3><p>{note}</p></div>)}
          </div></section><section className="mt-panel mt-system-source"><SectionHead eyebrow="DATA INTEGRITY" title="Reporting boundaries"/>
            <p>Mode operasional hanya membaca health API staging setelah verifikasi Supabase master-admin. Master heartbeat, fills, win rate, drawdown, dan anomaly log ditampilkan sebagai unavailable sampai pipeline telemetry worker diterapkan.</p><span>Data source: {data?.source||'UNAVAILABLE'}</span></section>
        </>}
        <footer className="mt-footer"><span>TRADEVICE / MASTER CONTROL CENTER</span><span>{preview?'SYNTHETIC PREVIEW · NO REAL ORDERS':'STAGING · ADMIN ONLY · READ-ONLY'}</span></footer>
      </main>
    </div>
    <nav className="mt-mobile-nav" data-active={tab} aria-label="Master mobile navigation">{routes.map(route=><button type="button" key={route.key} onClick={()=>setTab(route.key)} className={tab===route.key?'current':''} aria-label={route.label} aria-current={tab===route.key?'page':undefined}><Glyph name={route.icon} size={19}/><span>{route.label.split(' ')[0]}</span></button>)}</nav>
  </div>;
}
