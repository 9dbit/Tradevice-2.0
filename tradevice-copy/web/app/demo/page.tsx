'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { calculateDemo, demoAccount, demoStrategies, demoTrades, formatDemoMoney } from '../../lib/demo-fixtures.mjs';
import './demo.css';

type Page = 'overview' | 'accounts' | 'strategies' | 'history' | 'funding' | 'referral';
const items: Array<{key: Page; label: string; icon: string}> = [
  { key: 'overview', label: 'Ringkasan', icon: 'home' },
  { key: 'accounts', label: 'Akun Paper', icon: 'wallet' },
  { key: 'strategies', label: 'Strategi', icon: 'trending' },
  { key: 'history', label: 'Riwayat', icon: 'activity' },
  { key: 'funding', label: 'Pendanaan', icon: 'lock' },
  { key: 'referral', label: 'Referral', icon: 'users' },
];
const numbers = calculateDemo();
const money = (amount: number) => '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Icon({ name, size = 21 }: { name: string; size?: number }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    {name === 'home' && <><path d="m3 10 9-7 9 7v10H3z" /><path d="M9 20v-7h6v7" /></>}
    {name === 'wallet' && <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18"/><path d="M16 14h2"/></>}
    {name === 'trending' && <><path d="M3 17h18M5 13l5-6 4 3 5-7"/><path d="M15 3h4v4"/></>}
    {name === 'activity' && <><path d="M3 12h4l3-7 4 14 3-7h4"/></>}
    {name === 'lock' && <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>}
    {name === 'users' && <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>}
    {name === 'shield' && <><path d="m12 2 8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>}
    {name === 'arrow' && <path d="M5 12h14m-6-6 6 6-6 6"/>}
    {name === 'logout' && <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9"/></>}
    {name === 'more' && <><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>}
    {name === 'check' && <path d="m5 12 4 4 10-10"/>}
  </svg>;
}
function Mark() { return <span aria-hidden="true" className="dmark"><i/><i/><i/></span>; }
function DemoNotice() {
  return <div className="demo-notice" role="note"><Icon name="shield"/><div><strong>DATA SINTETIS · DEMO READ-ONLY</strong><span>Semua saldo, grafik, trade, dan performa pada halaman ini hanyalah contoh tampilan, bukan hasil engine nyata.</span></div></div>;
}
function PerformanceChart() {
  const points = numbers.curve;
  const values = points.map(row => row.equity);
  const low = Math.min(...values) - 14;
  const high = Math.max(...values) + 14;
  const mapped = points.map((row, i) => {
    const x = (i / Math.max(1, points.length - 1)) * 800;
    const y = 195 - ((row.equity - low) / (high - low)) * 175;
    return { x, y };
  });
  const line = mapped.map(row => row.x.toFixed(1) + ',' + row.y.toFixed(1)).join(' ');
  const area = '0,220 ' + line + ' 800,220';
  return <div className="demo-chart">
    <div className="demo-chart-top"><div><div className="demo-kicker">EQUITY OVERVIEW</div><h2>Pertumbuhan portofolio</h2><p>Contoh 12 transaksi sintetis · 28 Sep–10 Okt</p></div><span className="demo-chip">SIMULATED</span></div>
    <svg className="demo-chart-svg" viewBox="0 0 800 225" role="img" aria-label="Grafik equity simulasi dari 1000 dolar ke 1112 dolar 40 sen">
      <defs><linearGradient id="demo-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#54fa84" stopOpacity=".22"/><stop offset="100%" stopColor="#54fa84" stopOpacity="0"/></linearGradient></defs>
      {[28,82,136,190].map(y=><line key={y} x1="0" y1={y} x2="800" y2={y} stroke="#20422a" strokeWidth=".8" strokeDasharray="3 8"/>)}
      <polyline points={area} fill="url(#demo-area)" stroke="none"/>
      <polyline points={line} fill="none" stroke="#5cff86" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={mapped[mapped.length-1].x} cy={mapped[mapped.length-1].y} r="6" fill="#65ff8a" stroke="#183f25" strokeWidth="5"/>
    </svg>
    <div className="demo-chart-foot"><span>28 SEP 2026</span><span>04 OKT</span><span>10 OKT 2026</span></div>
  </div>;
}
function Stat({label,value,detail,icon,accent}:{label:string;value:string;detail:string;icon:string;accent?:boolean}) {
  return <article className={'demo-stat' + (accent ? ' demo-stat-accent' : '')}><div className="demo-stat-head"><span>{label}</span><Icon name={icon} size={18}/></div><strong>{value}</strong><small>{detail}</small></article>;
}
function Trades({short=false}:{short?:boolean}) {
  const rows = short ? demoTrades.slice(-5).reverse() : [...demoTrades].reverse();
  return <section className="demo-card demo-trade-card"><div className="demo-section-head"><div><div className="demo-kicker">PAPER JOURNAL</div><h2>{short ? 'Transaksi terakhir' : 'Riwayat perdagangan'}</h2></div><span className="demo-chip">SIMULASI</span></div>
    <div className="demo-table-wrap"><table className="demo-table"><thead><tr><th>ID / Tanggal</th><th>Pair / Arah</th><th className="demo-right">P/L Demo</th></tr></thead><tbody>{rows.map(trade=><tr key={trade.id}><td><strong>{trade.id}</strong><small>{trade.date} 2026</small></td><td><strong>{trade.symbol}</strong><small>{trade.side} · Closed</small></td><td className={'demo-right '+(trade.pnl>=0 ? 'demo-positive':'demo-negative')}><strong>{formatDemoMoney(trade.pnl)}</strong><small>{trade.r>0?'+':''}{trade.r.toFixed(2)} R</small></td></tr>)}</tbody></table></div>
  </section>;
}
function Locked({kind}:{kind:'funding'|'referral'}) {
  return <section className="demo-card demo-locked"><div className="demo-locked-badge"><Icon name="lock" size={27}/></div><h2>{kind==='funding'?'Pendanaan terkunci':'Program referral terkunci'}</h2><p>{kind==='funding'?'Deposit dan withdrawal tidak tersedia pada akun demo. Tradevice tidak menyimpan atau menerima uang pelanggan.':'Komisi, atribusi IB dan undangan member sungguhan tidak aktif pada mode demo.'}</p><div className="demo-disabled-actions">{kind==='funding'?<><button disabled>Deposit dinonaktifkan</button><button disabled>Withdrawal dinonaktifkan</button></>:<button disabled>Bagikan link referral (nonaktif)</button>}</div><small>DEMO ONLY · No live trading</small></section>;
}

export default function DemoPage() {
  const [ready,setReady]=useState(false);
  const [signed,setSigned]=useState(false);
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [page,setPage]=useState<Page>('overview');
  const [more,setMore]=useState(false);

  useEffect(()=>{
    try { setSigned(sessionStorage.getItem('tradevice-copy-demo-session')==='1'); } catch { setSigned(false); }
    setReady(true);
  },[]);
  useEffect(()=>{
    if(!more) return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setMore(false);};
    document.addEventListener('keydown',key);
    return ()=>document.removeEventListener('keydown',key);
  },[more]);
  function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    if(username.trim().toLowerCase() === 'admin' && password === 'admin') {
      try { sessionStorage.setItem('tradevice-copy-demo-session','1'); } catch {/* ephemeral client-side demo */}
      setSigned(true);setPassword('');setPage('overview');
    } else {setError('Username atau password demo tidak cocok. Gunakan admin / admin.');}
  }
  function logout(){
    try {sessionStorage.removeItem('tradevice-copy-demo-session');} catch {/* ignored */}
    setSigned(false);setUsername('');setPassword('');setPage('overview');setMore(false);
  }
  function visit(target:Page){setPage(target);setMore(false);window.scrollTo({top:0,behavior:'auto'});}

  if(!ready)return <div className="demo-gate"><div className="demo-gate-box"><Mark/><p>Mempersiapkan dashboard demo...</p></div></div>;
  if(!signed)return <div className="demo-gate">
    <div className="demo-gate-box"><div className="demo-gate-brand"><Mark/><strong>tradevice<span>.</span></strong><small>COPY</small></div>
      <span className="demo-chip demo-demo-chip">STAGING PREVIEW</span><h1>Selamat datang<span>.</span></h1><p className="demo-gate-lead">Akses dashboard copy trading untuk melihat antarmuka mobile dan data ilustrasi tanpa risiko uang nyata.</p>
      <form className="demo-login-form" onSubmit={login}><label htmlFor="demo-username">Username demo</label><input id="demo-username" value={username} onChange={e=>setUsername(e.target.value)} name="username" autoComplete="off" autoCapitalize="none" autoCorrect="off" placeholder="admin" required/>
        <label htmlFor="demo-password">Password demo</label><input id="demo-password" value={password} onChange={e=>setPassword(e.target.value)} name="password" type="password" autoComplete="off" placeholder="admin" required/>
        {error&&<p className="demo-form-error" role="alert">{error}</p>}
        <button className="demo-login-btn" type="submit">Masuk ke demo <Icon name="arrow" size={18}/></button>
      </form>
      <div className="demo-credentials"><span>Akun demo publik</span><strong>admin / admin</strong><small>Hanya preview visual. Bukan login Supabase atau hak admin sungguhan.</small></div>
      <a href="/" className="demo-back-link">Kembali ke portal member</a>
    </div>
    <aside className="demo-gate-art"><div className="demo-art-circle"><Mark/></div><strong>TRADEVICE<br/>COPY TRADING</strong><p>Designed for clarity.<br/>Built around risk.</p><span>DATA SINTETIS · No live trading</span></aside>
  </div>;

  return <div className="demo-app">
    <a href="#demo-main" className="demo-skip">Lewati navigasi</a>
    <aside className="demo-sidebar">
      <a href="/demo" className="demo-brand" aria-label="Tradevice Copy Demo"><Mark/><div><strong>tradevice<span>.</span></strong><small>COPY TRADING</small></div></a>
      <div className="demo-sidebar-note">WORKSPACE <span>/</span> SIMULATION</div>
      <nav aria-label="Demo desktop navigation" className="demo-side-nav">{items.map(item=><button key={item.key} onClick={()=>visit(item.key)} className={page===item.key?'selected':''} aria-current={page===item.key?'page':undefined}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
      <div className="demo-sidebar-foot"><div className="demo-sidebar-info"><Icon name="shield" size={19}/><div><strong>Safe demo mode</strong><small>Read-only · No live trading</small></div></div><button className="demo-logout" type="button" onClick={logout}><Icon name="logout" size={17}/> Keluar demo</button></div>
    </aside>

    <div className="demo-workspace"><header className="demo-topbar">
      <div className="demo-mobile-brand"><Mark/><strong>tradevice<span>.</span></strong><small>COPY</small></div>
      <div className="demo-top-title"><small>TRADEVICE / PAPER WORKSPACE</small><strong>{items.find(i=>i.key===page)?.label}</strong></div>
      <div className="demo-top-right"><span className="demo-top-live"><i/> DEMO</span><span className="demo-avatar">A</span><button type="button" className="demo-mobile-logout" aria-label="Keluar dari demo" onClick={logout}><Icon name="logout" size={19}/></button></div>
    </header>
    <main id="demo-main" className="demo-main" tabIndex={-1}>
      <div className="demo-welcome"><div><span className="demo-kicker">DASHBOARD / ADMIN DEMO</span><h1>{page==='overview'?'Welcome back, Admin.':items.find(i=>i.key===page)?.label}<br/>{page==='overview'&&<em>Your trading overview.</em>}</h1><p>Akun <strong>{demoAccount.id}</strong> · Semua statistik di bawah menggunakan contoh data sintetis.</p></div><div className="demo-welcome-art" aria-hidden="true"><Mark/><span>SIMULATOR<br/>ACTIVE</span></div></div>
      <DemoNotice/>
      {page==='overview'&&<>
        <div className="demo-section-head demo-overview-head"><div><div className="demo-kicker">PERFORMANCE / SAMPLE DATA</div><h2>Portfolio overview</h2></div><span className="demo-period">28 SEP - 10 OKT 2026</span></div>
        <div className="demo-stat-grid">
          <Stat label="Equity simulasi" value={money(numbers.equity)} detail="Modal awal $1,000.00" icon="wallet" accent/>
          <Stat label="Total Profit / Loss" value={formatDemoMoney(numbers.netPnl)} detail={'+'+numbers.returnPct.toFixed(2)+'% dari modal simulasi'} icon="trending"/>
          <Stat label="Win Rate" value={numbers.winRatePct.toFixed(1)+'%'} detail={numbers.wins+' win · '+numbers.losses+' loss'} icon="activity"/>
          <Stat label="Max Drawdown" value={numbers.maxDrawdownPct.toFixed(2)+'%'} detail="Dihitung dari kurva contoh" icon="shield"/>
        </div>
        <div className="demo-overview-columns"><PerformanceChart/><div className="demo-card demo-summary-card"><div className="demo-kicker">SIMULATED STATISTICS</div><h2>Statistik paper</h2><div className="demo-mini-row"><span>Total order</span><strong>{numbers.total}</strong></div><div className="demo-mini-row"><span>Winning trades</span><strong>{numbers.wins}</strong></div><div className="demo-mini-row"><span>Losing trades</span><strong>{numbers.losses}</strong></div><div className="demo-mini-row"><span>Profit factor</span><strong>{numbers.profitFactor?.toFixed(2)??'N/A'}</strong></div><div className="demo-mini-row"><span>Mode eksekusi</span><strong className="demo-positive">PAPER</strong></div><p>Statistik ini dihitung dari 12 transaksi sampel yang disertakan dalam kode frontend. Tidak bersumber dari broker.</p></div></div>
        <Trades short/>
      </>}
      {page==='accounts'&&<><div className="demo-section-head"><div><div className="demo-kicker">DEMO ACCOUNT</div><h2>Akun dan pengendalian risiko</h2></div><span className="demo-chip">SIMULATED</span></div>
        <div className="demo-account-card"><div className="demo-account-head"><div className="demo-account-icon"><Icon name="wallet" size={28}/></div><div><small>SIMULATOR ACCOUNT</small><h2>{demoAccount.id}</h2><p>{demoAccount.broker}</p></div><span className="demo-account-status">DEMO ONLY</span></div><div className="demo-account-balance"><span>Equity sample</span><strong>{money(numbers.equity)}</strong><p>Modal awal: {money(numbers.startingEquity)} · Data sintetis</p></div></div>
        <div className="demo-stat-grid demo-risk-grid"><Stat label="Risk per trade" value="0.25%" detail="Hanya konfigurasi contoh" icon="shield"/><Stat label="Daily loss limit" value="2.00%" detail="Hanya konfigurasi contoh" icon="lock"/><Stat label="Paper orders" value={String(numbers.total)} detail="Data contoh" icon="activity"/><Stat label="Copy status" value="Nonaktif" detail="Live execution disabled" icon="lock"/></div>
        <div className="demo-card demo-readonly"><Icon name="shield"/><div><h2>Akun read-only</h2><p>Demo tidak membuka, mengubah, atau menyinkronkan akun ke Supabase. Angka ekuitas tidak mewakili dana riil.</p></div></div>
      </>}
      {page==='strategies'&&<><div className="demo-section-head"><div><div className="demo-kicker">RESEARCH STRATEGIES</div><h2>Strategi riset</h2></div><span className="demo-chip">PAPER ONLY</span></div>
        <div className="demo-strategy-grid">{demoStrategies.map((strategy,i)=><article key={strategy.code} className="demo-card demo-strategy"><div className="demo-strategy-top"><div className="demo-strategy-icon"><Icon name="trending" size={22}/></div><span className="demo-chip">SIMULATED</span></div><small>STRATEGY 0{i+1}</small><h2>{strategy.code}</h2><p>{strategy.style}</p><div className="demo-mini-row"><span>Instrument</span><strong>{strategy.symbol}</strong></div><div className="demo-mini-row"><span>Risk allocation</span><strong>{strategy.risk}</strong></div><div className="demo-mini-row"><span>Availability</span><strong>{strategy.status}</strong></div><button disabled>Copy trading live dinonaktifkan</button></article>)}</div>
      </>}
      {page==='history'&&<><div className="demo-section-head"><div><div className="demo-kicker">SIMULATED HISTORY</div><h2>Trade journal</h2></div><span className="demo-chip">{numbers.total} SAMPLE ORDERS</span></div><div className="demo-history-metrics"><Stat label="Sample closed trades" value={String(numbers.total)} detail="Tidak ada broker fill" icon="activity"/><Stat label="Winning / Losing" value={numbers.wins+' / '+numbers.losses} detail="Hanya ilustrasi" icon="trending"/><Stat label="Net example P/L" value={formatDemoMoney(numbers.netPnl)} detail="Bukan hasil riil" icon="wallet"/></div><Trades/></>}
      {page==='funding'&&<Locked kind="funding"/>}
      {page==='referral'&&<Locked kind="referral"/>}
    </main>
    <footer className="demo-footer"><span>TRADEVICE COPY © 2026 · READ-ONLY DEMO</span><span>DATA SINTETIS · No live trading · No real money</span></footer></div>

    <nav className="demo-bottom-nav" aria-label="Demo mobile navigation">
      {items.slice(0,4).map(item=><button type="button" key={item.key} className={page===item.key?'selected':''} aria-current={page===item.key?'page':undefined} onClick={()=>visit(item.key)}><Icon name={item.icon} size={20}/><span>{item.label==='Akun Paper'?'Akun':item.label}</span></button>)}
      <button type="button" className={page==='funding'||page==='referral'||more?'selected':''} aria-controls="demo-more-sheet" aria-expanded={more} onClick={()=>setMore(open=>!open)}><Icon name="more" size={20}/><span>Lainnya</span></button>
    </nav>
    {more&&<><button type="button" className="demo-scrim" aria-label="Tutup menu" onClick={()=>setMore(false)}/><div className="demo-more-sheet" id="demo-more-sheet" role="dialog" aria-label="Menu lainnya"><span className="demo-sheet-grip"/><h2>Lainnya</h2>{items.slice(4).map(item=><button type="button" key={item.key} onClick={()=>visit(item.key)}><Icon name={item.icon}/>{item.label}<Icon name="arrow" size={17}/></button>)}<button type="button" onClick={logout}><Icon name="logout"/>Keluar demo<Icon name="arrow" size={17}/></button><p>DATA SINTETIS · Read-only preview</p></div></>}
  </div>;
}
