'use client';

import { useEffect, useState } from 'react';
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

function Icon({ name, size = 21 }: { name: string; size?: number }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    {name === 'home' && <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>}
    {name === 'wallet' && <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18"/><path d="M16 14h2"/></>}
    {name === 'trending' && <><path d="M3 17h18M5 13l5-6 4 3 5-7"/><path d="M15 3h4v4"/></>}
    {name === 'activity' && <><path d="M3 12h4l3-7 4 14 3-7h4"/></>}
    {name === 'lock' && <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>}
    {name === 'users' && <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>}
    {name === 'shield' && <><path d="m12 2 8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>}
    {name === 'arrow' && <path d="M5 12h14m-6-6 6 6-6 6"/>}
    {name === 'more' && <><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>}
  </svg>;
}
function Mark() {
  return <span aria-hidden="true" className="dmark"><img src="/brand/tradevice-arrow.svg?v=orange-20261012" width={39} height={39} alt="" draggable={false}/></span>;
}
function Stat({label,detail,icon,accent}:{label:string;detail:string;icon:string;accent?:boolean}) {
  return <article className={'demo-stat'+(accent?' demo-stat-accent':'')}>
    <div className="demo-stat-head"><span>{label}</span><Icon name={icon} size={18}/></div>
    <strong>—</strong><small>{detail}</small>
  </article>;
}
function DemoNotice() {
  return <div className="demo-notice" role="status"><Icon name="shield"/><div>
    <strong>BELUM ADA DATA TRADING DEMO</strong>
    <span>Seluruh contoh saldo, trade, grafik, dan strategi telah dihapus. Hanya data paper trading terverifikasi yang boleh ditampilkan setelah integrasi.</span>
  </div></div>;
}
function EmptyChart() {
  return <div className="demo-chart">
    <div className="demo-chart-top"><div><div className="demo-kicker">EQUITY OVERVIEW</div>
      <h2>Pertumbuhan portofolio</h2><p>Menunggu hasil eksekusi paper yang terverifikasi.</p>
    </div><span className="demo-chip">NO DATA</span></div>
    <div className="demo-chart-svg demo-empty-chart" role="status">
      <Icon name="activity" size={27}/><strong>Belum ada kurva equity</strong>
      <p>Tidak ada grafik atau nilai awal yang dibuat secara otomatis.</p>
    </div>
  </div>;
}
function Trades({short=false}:{short?:boolean}) {
  return <section className="demo-card demo-trade-card">
    <div className="demo-section-head"><div><div className="demo-kicker">PAPER JOURNAL</div>
      <h2>{short?'Transaksi terakhir':'Riwayat perdagangan'}</h2></div><span className="demo-chip">NO ORDERS</span></div>
    <div className="demo-empty-orders" role="status">
      <Icon name="activity" size={25}/><strong>Belum ada transaksi paper yang terverifikasi</strong>
      <p>Riwayat akan tersedia setelah terhubung ke paper broker adapter dan jurnal yang sah.</p>
    </div>
  </section>;
}
function Locked({kind}:{kind:'funding'|'referral'}) {
  return <section className="demo-card demo-locked"><div className="demo-locked-badge"><Icon name="lock" size={27}/></div>
    <h2>{kind==='funding'?'Pendanaan terkunci':'Program referral terkunci'}</h2>
    <p>{kind==='funding'?'Deposit dan withdrawal tidak tersedia pada akun demo. Tradevice tidak menyimpan atau menerima uang pelanggan.':'Komisi, atribusi IB, dan undangan member sungguhan belum diaktifkan pada staging.'}</p>
    <div className="demo-disabled-actions">{kind==='funding'?<><button disabled>Deposit dinonaktifkan</button><button disabled>Withdrawal dinonaktifkan</button></>:<button disabled>Bagikan link referral (nonaktif)</button>}</div>
    <small>PAPER ONLY · No live trading</small>
  </section>;
}
export default function DemoPage() {
  const [page,setPage]=useState<Page>('overview');
  const [more,setMore]=useState(false);
  useEffect(()=>{
    if(!more)return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setMore(false);};
    document.addEventListener('keydown',key);
    return()=>document.removeEventListener('keydown',key);
  },[more]);
  function visit(target:Page){
    setPage(target);setMore(false);window.scrollTo({top:0,behavior:'auto'});
  }
  return <div className="demo-app">
    <a href="#demo-main" className="demo-skip">Lewati navigasi</a>
    <aside className="demo-sidebar">
      <a href="/demo" className="demo-brand" aria-label="Tradevice Paper Demo"><Mark/><div><strong>tradevice<span>.</span></strong><small>COPY TRADING</small></div></a>
      <div className="demo-sidebar-note">WORKSPACE <span>/</span> PAPER STAGING</div>
      <nav aria-label="Demo desktop navigation" className="demo-side-nav">{items.map(item=><button key={item.key} onClick={()=>visit(item.key)} className={page===item.key?'selected':''} aria-current={page===item.key?'page':undefined}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
      <div className="demo-sidebar-foot"><div className="demo-sidebar-info"><Icon name="shield" size={19}/><div><strong>Paper staging</strong><small>No live trading · No deposits</small></div></div>
        <a className="demo-logout" href="/master">Master login <Icon name="arrow" size={17}/></a>
      </div>
    </aside>
    <div className="demo-workspace"><header className="demo-topbar">
      <div className="demo-mobile-brand"><Mark/><strong>tradevice<span>.</span></strong><small>COPY</small></div>
      <div className="demo-top-title"><small>TRADEVICE / PAPER WORKSPACE</small><strong>{items.find(i=>i.key===page)?.label}</strong></div>
      <div className="demo-top-right"><span className="demo-top-live"><i/> STAGING</span><span className="demo-avatar">P</span></div>
    </header>
    <main id="demo-main" className="demo-main" tabIndex={-1}>
      <div className="demo-welcome"><div><span className="demo-kicker">DASHBOARD / EMPTY PAPER WORKSPACE</span>
        <h1>{page==='overview'?'Paper trading.':items.find(i=>i.key===page)?.label}<br/>{page==='overview'&&<em>Menunggu transaksi pertama.</em>}</h1>
        <p>Akun paper belum terhubung. Tidak ada saldo, performa, atau posisi yang dikarang.</p>
      </div><div className="demo-welcome-art" aria-hidden="true"><Mark/><span>PAPER<br/>STAGING</span></div></div>
      <DemoNotice/>
      {page==='overview'&&<>
        <div className="demo-section-head demo-overview-head"><div><div className="demo-kicker">PERFORMANCE / VERIFIED DATA ONLY</div><h2>Portfolio overview</h2></div><span className="demo-period">BELUM TERSEDIA</span></div>
        <div className="demo-stat-grid">
          <Stat label="Equity paper" detail="Akun paper belum terhubung" icon="wallet" accent/>
          <Stat label="Total Profit / Loss" detail="Belum ada closed fills" icon="trending"/>
          <Stat label="Win Rate" detail="Belum ada hasil trading" icon="activity"/>
          <Stat label="Max Drawdown" detail="Belum ada equity terverifikasi" icon="shield"/>
        </div>
        <div className="demo-overview-columns"><EmptyChart/>
          <div className="demo-card demo-summary-card"><div className="demo-kicker">PAPER STATISTICS</div><h2>Statistik paper</h2>
            <div className="demo-mini-row"><span>Total order</span><strong>—</strong></div>
            <div className="demo-mini-row"><span>Winning trades</span><strong>—</strong></div>
            <div className="demo-mini-row"><span>Losing trades</span><strong>—</strong></div>
            <div className="demo-mini-row"><span>Profit factor</span><strong>—</strong></div>
            <div className="demo-mini-row"><span>Mode eksekusi</span><strong>PAPER · DISABLED</strong></div>
            <p>Nilai akan diisi hanya dari jurnal paper broker yang tervalidasi. Tidak ada transaksi yang dikirim dari halaman ini.</p>
          </div>
        </div>
        <Trades short/>
      </>}
      {page==='accounts'&&<>
        <div className="demo-section-head"><div><div className="demo-kicker">PAPER ACCOUNT</div><h2>Akun dan pengendalian risiko</h2></div><span className="demo-chip">NOT CONNECTED</span></div>
        <div className="demo-account-card"><div className="demo-account-head"><div className="demo-account-icon"><Icon name="wallet" size={28}/></div>
          <div><small>PAPER ACCOUNT</small><h2>Belum terhubung</h2><p>Broker demo belum dikonfigurasi.</p></div>
          <span className="demo-account-status">NO ACCOUNT</span></div>
          <div className="demo-account-balance"><span>Equity paper</span><strong>—</strong><p>Belum ada saldo akun terverifikasi.</p></div>
        </div>
        <div className="demo-stat-grid demo-risk-grid"><Stat label="Risk per trade" detail="Belum dikonfigurasi" icon="shield"/>
          <Stat label="Daily loss limit" detail="Belum dikonfigurasi" icon="lock"/>
          <Stat label="Paper orders" detail="Menunggu audit order" icon="activity"/>
          <Stat label="P/L" detail="Belum ada fill terverifikasi" icon="wallet"/></div>
        <div className="demo-card demo-readonly"><Icon name="shield"/><div><h2>Akun read-only</h2>
          <p>Operasi deposit, penarikan, dan copy execution tetap nonaktif. Hubungkan broker paper tepercaya terlebih dahulu.</p></div></div>
      </>}
      {page==='strategies'&&<>
        <div className="demo-section-head"><div><div className="demo-kicker">STRATEGY REGISTRY</div><h2>Strategi</h2></div><span className="demo-chip">NONE CONFIGURED</span></div>
        <div className="demo-card demo-readonly"><Icon name="shield"/><div><h2>Belum ada strategi yang dijalankan</h2>
          <p>Strategi, alokasi risiko, dan sinyal pasar tidak ditampilkan sampai terhubung ke sumber yang disetujui.</p>
          <button disabled>Copy trading live dinonaktifkan</button></div></div>
      </>}
      {page==='history'&&<>
        <div className="demo-section-head"><div><div className="demo-kicker">PAPER HISTORY</div><h2>Trade journal</h2></div><span className="demo-chip">NO DATA</span></div>
        <div className="demo-history-metrics"><Stat label="Closed trades" detail="Belum ada fill" icon="activity"/>
          <Stat label="Winning / Losing" detail="Belum ada sampel sah" icon="trending"/>
          <Stat label="Net paper P/L" detail="Tidak ada hasil terukur" icon="wallet"/></div><Trades/>
      </>}
      {page==='funding'&&<Locked kind="funding"/>}
      {page==='referral'&&<Locked kind="referral"/>}
      <div className="demo-footer"><span>TRADEVICE COPY © 2026 · PAPER STAGING</span><span>NO SAMPLE DATA · No live trading · No real money</span></div>
    </main></div>
    <nav className="demo-bottom-nav" aria-label="Demo mobile navigation">
      {items.slice(0,4).map(item=><button type="button" key={item.key} className={page===item.key?'selected':''} aria-current={page===item.key?'page':undefined} onClick={()=>visit(item.key)}><Icon name={item.icon} size={20}/><span>{item.label==='Akun Paper'?'Akun':item.label}</span></button>)}
      <button type="button" className={page==='funding'||page==='referral'||more?'selected':''} aria-controls="demo-more-sheet" aria-expanded={more} onClick={()=>setMore(open=>!open)}><Icon name="more" size={20}/><span>Lainnya</span></button>
    </nav>
    {more&&<><button type="button" className="demo-scrim" aria-label="Tutup menu" onClick={()=>setMore(false)}/>
      <div className="demo-more-sheet" id="demo-more-sheet" role="dialog" aria-label="Menu lainnya"><span className="demo-sheet-grip"/><h2>Lainnya</h2>
        {items.slice(4).map(item=><button type="button" key={item.key} onClick={()=>visit(item.key)}><Icon name={item.icon}/>{item.label}<Icon name="arrow" size={17}/></button>)}
        <a className="demo-logout" href="/master">Master login <Icon name="arrow" size={17}/></a>
        <p>NO SAMPLE DATA · Read-only staging workspace</p>
      </div></>}
  </div>;
}
