'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { authErrorMessage, canApplySessionResult, readItems } from '../lib/member-contract.mjs';
import type { PublicConfig } from '../lib/runtime.mjs';

type Item = { id: string; [key: string]: unknown };
const navigation = [
  { key: 'Overview', label: 'Ringkasan', icon: 'home' },
  { key: 'Accounts', label: 'Akun', icon: 'wallet' },
  { key: 'Strategies', label: 'Strategi', icon: 'strategy' },
  { key: 'Trading', label: 'Riwayat', icon: 'activity' },
  { key: 'Funding', label: 'Pendanaan', icon: 'funding' },
  { key: 'Referral', label: 'Referral', icon: 'users' },
] as const;
type Page = (typeof navigation)[number]['key'];
const primary: Page[] = ['Overview', 'Accounts', 'Strategies', 'Trading'];
const extra: Page[] = ['Funding', 'Referral'];

function Icon({ name }: { name: string }) {
  const shared = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" {...shared}>
    {name === 'home' && <><path d="m3 10 9-7 9 7v10H3z" /><path d="M9 20v-7h6v7" /></>}
    {name === 'wallet' && <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18"/><path d="M16 14h2"/></>}
    {name === 'strategy' && <><path d="M4 19h16M5 15l5-6 4 3 5-8"/><path d="M15 4h4v4"/></>}
    {name === 'activity' && <><path d="M3 12h4l3-7 4 14 3-7h4"/></>}
    {name === 'funding' && <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M7 16h4"/></>}
    {name === 'users' && <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>}
    {name === 'refresh' && <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a7 7 0 0 1 12-2l3 5M4 12l3 5a7 7 0 0 0 12-2"/></>}
    {name === 'more' && <><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>}
    {name === 'shield' && <><path d="m12 2 8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>}
    {name === 'lock' && <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>}
    {name === 'arrow' && <path d="M5 12h14m-6-6 6 6-6 6"/>}
  </svg>;
}
function Brand() {
  return <span className="brand-sign" aria-hidden="true"><img src="/brand/tradevice-arrow.svg?v=orange-20261012" width={39} height={39} alt="" draggable={false}/></span>;
}
function Empty({ heading, note }: { heading: string; note: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="activity"/></div><strong>{heading}</strong><p>{note}</p></div>;
}
function safeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Belum tersedia';
}
function percent(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Belum tersedia';
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number.toFixed(2) + '%' : 'Belum tersedia';
}

export default function Home() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [apiStatus, setApiStatus] = useState('checking');
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [dataError, setDataError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [page, setPage] = useState<Page>('Overview');
  const [moreOpen, setMoreOpen] = useState(false);
  const [accounts, setAccounts] = useState<Item[]>([]);
  const [strategies, setStrategies] = useState<Item[]>([]);
  const [referrals, setReferrals] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Item[]>([]);
  const [risk, setRisk] = useState<Record<string, unknown> | null>(null);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const identity = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const controller = new AbortController();
    async function initialize() {
      try {
        const response = await fetch('/api/runtime', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
        const cfg: PublicConfig = await response.json();
        if (disposed) return;
        setConfig(cfg);
        if (!cfg.configured || !cfg.supabaseUrl || !cfg.publishableKey) return;
        const supabase = createClient(cfg.supabaseUrl, cfg.publishableKey);
        setClient(supabase);
        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          // This callback remains synchronous to avoid an auth SDK deadlock.
          if (disposed) return;
          const nextId = nextSession?.user.id ?? null;
          if (identity.current !== nextId || !nextSession) {
            identity.current = nextId;
            epoch.current += 1;
            setAccounts([]); setStrategies([]); setReferrals([]); setOrders([]);
            setRisk(null); setSelectedAccount(''); setVerified(false); setHasMore(false); setDataError('');
          }
          setSession(nextSession);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch {
        if (!disposed && !controller.signal.aborted) setAuthMessage('Konfigurasi autentikasi belum dapat dimuat.');
      }
    }
    void initialize();
    return () => { disposed = true; controller.abort(); unsubscribe?.(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch('/api/status', { cache: 'no-store', signal: controller.signal })
      .then(r => r.json()).then(data => { if (!cancelled) setApiStatus(String(data.status ?? 'unavailable')); })
      .catch(() => { if (!cancelled) setApiStatus('unavailable'); });
    return () => { cancelled = true; controller.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!session?.access_token || !client) { setLoading(false); return; }
    const currentEpoch = epoch.current;
    const controller = new AbortController();
    setLoading(true); setVerified(false); setDataError('');
    setAccounts([]); setStrategies([]); setReferrals([]); setSelectedAccount(''); setOrders([]); setRisk(null);
    async function load() {
      try {
        const read = async (path: string) => {
          const response = await fetch('/api/member/' + path, {
            headers: { Authorization: 'Bearer ' + session!.access_token }, cache: 'no-store', signal: controller.signal,
          });
          if (!response.ok) throw new Error('MEMBER_DATA_UNAVAILABLE');
          return response.json();
        };
        const me = await read('me');
        if (me.id !== session!.user.id) throw new Error('IDENTITY_MISMATCH');
        const [a, s, r] = await Promise.all([read('accounts'), read('strategies'), read('referrals')]);
        const owned = readItems(a), catalogue = readItems(s), referralsList = readItems(r);
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) {
          setAccounts(owned); setStrategies(catalogue); setReferrals(referralsList);
          setSelectedAccount(owned.length ? owned[0].id : '');
          setHasMore(a.next_offset != null);
          setVerified(true);
        }
      } catch {
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) {
          setAccounts([]); setStrategies([]); setReferrals([]); setSelectedAccount(''); setVerified(false);
          setDataError('Data member belum dapat diverifikasi. Saldo dan performa tidak akan direka. Silakan coba lagi.');
        }
      } finally {
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [session?.access_token, session?.user.id, client, refresh]);

  useEffect(() => {
    setOrders([]); setRisk(null);
    if (!session?.access_token || !verified || !selectedAccount) { setDetailLoading(false); return; }
    const currentEpoch = epoch.current;
    const controller = new AbortController();
    setDetailLoading(true);
    const read = async (path: string) => {
      const response = await fetch('/api/member/' + path, {
        headers: { Authorization: 'Bearer ' + session.access_token }, cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('ACCOUNT_DATA_UNAVAILABLE');
      return response.json();
    };
    Promise.all([read('accounts/' + selectedAccount + '/risk'), read('accounts/' + selectedAccount + '/orders')])
      .then(([r, o]) => {
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) {
          setRisk(r?.profile && typeof r.profile === 'object' ? r.profile : null);
          setOrders(readItems(o));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) {
          setRisk(null); setOrders([]);
          setDataError('Riwayat atau profil risiko akun belum bisa dimuat.');
        }
      })
      .finally(() => { if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) setDetailLoading(false); });
    return () => controller.abort();
  }, [session?.access_token, selectedAccount, verified, refresh]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !config?.configured || busy) return;
    setBusy(true); setAuthMessage('');
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setAuthMessage(authErrorMessage(error)); return; }
      setPassword('');
    } catch {
      setAuthMessage('Autentikasi sementara tidak tersedia. Coba lagi.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (!client || busy) return;
    epoch.current += 1; setAccounts([]); setStrategies([]); setReferrals([]); setOrders([]);
    setSelectedAccount(''); setRisk(null); setVerified(false); setLoading(false); setDetailLoading(false);
    setBusy(true); setAuthMessage('');
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) { setAuthMessage('Keluar belum terkonfirmasi. Silakan coba lagi.'); return; }
      identity.current = null; setSession(null); setPassword(''); setDataError('');
    } catch { setAuthMessage('Keluar belum terkonfirmasi. Silakan coba lagi.'); }
    finally { setBusy(false); }
  }

  function visit(next: Page) {
    setPage(next); setMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  const title = navigation.find(item => item.key === page)?.label ?? 'Ringkasan';
  const apiOnline = apiStatus === 'api_online';

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Lewati navigasi</a>
    <aside className="sidebar">
      <div className="sidebar-top">
        <a className="brand" href="/" aria-label="Tradevice Copy, beranda"><Brand/><span><strong>tradevice<span className="brand-accent">.</span></strong><small>COPY FOUNDATION</small></span></a>
        <div className="sidebar-caption">WORKSPACE <span>/</span> STAGING</div>
      </div>
      <nav className="sidebar-nav" aria-label="Navigasi desktop">
        {navigation.map(item => <button key={item.key} type="button" onClick={() => visit(item.key)} aria-current={page === item.key ? 'page' : undefined} className={'sidebar-link' + (page === item.key ? ' is-active' : '')}>
          <Icon name={item.icon}/><span>{item.label}</span>{page === item.key && <span className="active-dot"/>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="mode-box"><span className="status-dot"/><div><strong>Mode Simulasi</strong><small>Paper only · Non-custodial</small></div></div>
        <p>Tradevice Copy / v0.4<br/>Lingkungan uji terisolasi</p>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar" aria-label="Tradevice Copy, mode simulasi">
        <div className="desktop-top-label"><span>TRADEVICE / MEMBER PORTAL</span><strong>{title}</strong></div>
        <div className="mobile-brand"><Brand/><span className="mobile-wordmark"><strong>tradevice<span className="brand-accent">.</span></strong><small>COPY</small></span></div>
        <div className="top-actions"><span className="paper-chip" role="status" aria-label="Mode paper aktif, eksekusi live nonaktif" title="Simulasi saja. Tidak ada eksekusi live"><span className="status-dot"/> PAPER</span><button type="button" className="icon-button" aria-label="Muat ulang data" title="Muat ulang" onClick={() => setRefresh(x => x + 1)} disabled={loading}><Icon name="refresh"/></button></div>
      </header>

      <main id="main-content" className="content" tabIndex={-1}>
        <section className="hero" aria-label="Ringkasan workspace">
          <div><div className="eyebrow"><span className="eyebrow-line"/> STAGING · MOBILE READY</div>
            <h1>{session?.user.email ? 'Selamat datang.' : 'Trading yang terukur.'}<br/><span>{session?.user.email ? 'Semua tetap terkendali.' : 'Risiko dalam kendali.'}</span></h1>
            <p>Portal riset copy trading dengan akses member terpisah. Tidak ada order live atau dana yang disimpan di Tradevice.</p>
            {!session && <button type="button" className="hero-link" onClick={() => document.getElementById('member-access')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Akses member <Icon name="arrow"/></button>}

          </div>
          <div className="hero-mark" aria-hidden="true"><span className="hero-mark-ring"><Brand/></span><strong>SIMULATION</strong><small>Execution locked</small></div>
        </section>

        <div className="safety-banner" role="status"><Icon name="shield"/><div><strong>PAPER-ONLY TEST ENVIRONMENT</strong><p>Copy trading live, deposit, withdrawal, serta komisi masih dinonaktifkan.</p></div></div>

        {loading && <div className="loading-strip" role="status">Memverifikasi identitas dan memuat data dari Supabase...</div>}
        {dataError && <div className="error-strip" role="alert">{dataError}<button type="button" onClick={() => setRefresh(x => x + 1)}>Coba lagi</button></div>}
        <div className="dashboard-grid">
          <div className="dashboard-main">
            {page === 'Overview' && <>
              <div className="section-title"><div><span className="eyebrow">RINGKASAN</span><h2>Portfolio overview</h2></div><span className="quiet-label">Data terverifikasi saja</span></div>
              <div className="stat-grid">
                {[
                  { label: 'Total Equity', icon: 'wallet' },
                  { label: 'Total P/L', icon: 'strategy' },
                  { label: 'Win Rate', icon: 'activity' },
                  { label: 'Max Drawdown', icon: 'shield' },
                ].map(s => <article className="stat-card" key={s.label}><div className="stat-top"><span>{s.label}</span><Icon name={s.icon}/></div><strong>Belum tersedia</strong><small>Menunggu jurnal paper</small></article>)}
              </div>
              <article className="surface chart-panel"><div className="panel-heading"><div><span className="eyebrow">PERFORMANCE</span><h2>Equity curve</h2></div><span className="outline-chip">Belum ada data</span></div>
                <div className="chart-placeholder"><div className="chart-gridlines" aria-hidden="true"/><Empty heading="Belum ada histori equity" note="Grafik tampil setelah transaksi paper tercatat dan divalidasi. Tidak ada kurva atau hasil simulasi buatan."/></div>
              </article>
              <div className="double-cards">
                <article className="surface info-panel"><div className="panel-heading"><h2>Integrasi</h2><span className="outline-chip">STATUS</span></div>
                  <div className="integration-row"><span className={'status-dot' + (apiOnline ? '' : ' dim')}/><div><strong>Python member API</strong><small>{apiOnline ? 'Online / staging' : 'Belum terverifikasi'}</small></div></div>
                  <div className="integration-row"><span className={'status-dot' + (config?.configured ? '' : ' dim')}/><div><strong>Supabase Auth</strong><small>{config?.configured ? 'Dikonfigurasi / pilot only' : 'Belum terhubung'}</small></div></div>
                  <div className="integration-row"><span className="status-dot dim"/><div><strong>Broker execution</strong><small>Terkunci / no live trades</small></div></div>
                </article>
                <article className="surface info-panel"><div className="panel-heading"><h2>Akun pilot</h2><span className="outline-chip">READ ONLY</span></div>
                  <div className="count-row"><strong>{verified ? accounts.length : '—'}</strong><span>Akun simulasi milik member</span></div>
                  <p className="muted">{verified ? 'Akses diperiksa lewat JWT dan Row Level Security.' : 'Login untuk melihat akun dan strategi yang telah diizinkan.'}</p>
                  <button type="button" className="text-action" onClick={() => visit('Accounts')}>Lihat akun <Icon name="arrow"/></button>
                </article>
              </div>
            </>}

            {page === 'Accounts' && <article className="surface full-panel"><div className="panel-heading"><div><span className="eyebrow">ACCOUNTS</span><h2>Akun & manajemen risiko</h2></div><span className="outline-chip">PAPER</span></div>
              {!verified ? <Empty heading="Akun belum dimuat" note="Login dan lolos verifikasi pilot untuk melihat akun paper milik Anda."/> :
              accounts.length ? <>
                <label className="field-label" htmlFor="account-select">Akun simulator</label>
                <select className="account-select" id="account-select" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{safeText(a.external_account_id)} ({safeText(a.environment)})</option>)}
                </select>
                <div className="risk-grid"><div><small>Risiko per transaksi</small><strong>{percent(risk?.risk_per_trade_pct)}</strong></div><div><small>Batas loss harian</small><strong>{percent(risk?.daily_loss_limit_pct)}</strong></div><div><small>Copy execution</small><strong>Nonaktif</strong></div><div><small>Profil risiko</small><strong>{detailLoading ? 'Memuat...' : risk ? 'Tersimpan' : 'Belum tersedia'}</strong></div></div>
                <p className="muted">Mode baca saja. Tidak ada penyetoran dana atau koneksi broker live.</p>
                {hasMore && <p className="muted">Menampilkan 50 akun pertama. Pagination lanjutan tersedia melalui API.</p>}
              </> : <Empty heading="Belum ada akun paper" note="Akun pilot baru dapat dibuat setelah member diverifikasi. Tidak ada saldo atau equity yang diasumsikan."/>}
            </article>}

            {page === 'Strategies' && <article className="surface full-panel"><div className="panel-heading"><div><span className="eyebrow">RESEARCH</span><h2>Strategi tersedia</h2></div><span className="outline-chip">NO LIVE COPY</span></div>
              {verified && strategies.length ? <div className="strategy-list">{strategies.map(s => <div className="strategy-row" key={s.id}><div className="strategy-icon"><Icon name="strategy"/></div><div className="strategy-copy"><strong>{safeText(s.code)}</strong><small>{safeText(s.symbol)} · Mode riset</small></div><button type="button" disabled aria-label={'Copy live terkunci untuk ' + safeText(s.code)}>Copy terkunci</button></div>)}</div> : <Empty heading="Belum ada strategi yang ditampilkan" note={verified ? 'Tidak ada strategi riset dalam database.' : 'Masuk untuk membaca strategi riset dari database.'}/>}
            </article>}

            {page === 'Trading' && <article className="surface full-panel"><div className="panel-heading"><div><span className="eyebrow">JOURNAL</span><h2>Riwayat order paper</h2></div><span className="outline-chip">BUKAN REAL FILL</span></div>
              {verified && accounts.length > 1 && <select aria-label="Pilih akun riwayat" className="account-select" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{safeText(a.external_account_id)}</option>)}</select>}
              {verified && orders.length ? <div className="table-scroll"><table><thead><tr><th>ID order</th><th>Status</th><th>Lingkungan</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td className="mono">{o.id.slice(0, 12)}…</td><td>{safeText(o.status)}</td><td>Paper</td></tr>)}</tbody></table></div> : <Empty heading="Belum ada order paper" note="Transaksi simulasi yang sudah tercatat akan muncul di sini. Order live tidak diaktifkan."/>}
              {detailLoading && <p role="status" className="muted">Memuat jurnal akun...</p>}
            </article>}

            {page === 'Funding' && <article className="surface full-panel"><div className="panel-heading"><div><span className="eyebrow">BROKER DIRECT</span><h2>Deposit & withdrawal</h2></div><span className="outline-chip">DISABLED</span></div>
              <div className="feature-locked"><span className="feature-lock-icon"><Icon name="lock"/></span><h3>Belum tersedia</h3><p>Tradevice tidak menerima dana. Pendanaan hanya dapat diproses langsung oleh broker berizin setelah integrasi, verifikasi, dan peninjauan regulasi selesai.</p><div className="disabled-actions"><button type="button" disabled>Deposit melalui broker</button><button type="button" disabled>Withdraw melalui broker</button></div></div>
            </article>}

            {page === 'Referral' && <article className="surface full-panel"><div className="panel-heading"><div><span className="eyebrow">REFERRAL</span><h2>Atribusi member</h2></div><span className="outline-chip">KOMISI OFF</span></div>
              {verified && referrals.length ? <div className="table-scroll"><table><thead><tr><th>Referensi</th><th>Atribusi broker</th></tr></thead><tbody>{referrals.map(r => <tr key={r.id}><td className="mono">{r.id.slice(0, 12)}…</td><td>{safeText(r.broker_attribution)}</td></tr>)}</tbody></table></div> : <Empty heading="Belum ada referral terverifikasi" note="Tidak ada komisi atau attribution IB yang diasumsikan. Rekonsiliasi broker belum diaktifkan."/>}
            </article>}
          </div>

          <aside className="member-column" aria-label="Akses dan batas keamanan">
            <section className="surface access-panel" id="member-access"><div className="eyebrow">MEMBER ACCESS</div><h2>{session ? 'Sesi member' : 'Masuk ke Tradevice'}</h2>
              {session ? <div className="signed-in"><div className="avatar">{(session.user.email ?? 'M').slice(0, 1).toUpperCase()}</div><strong className="user-email">{session.user.email ?? 'Member'}</strong><span className="session-caption">{verified ? 'Akses pilot terverifikasi' : 'Verifikasi akses pilot belum selesai'}</span><button type="button" className="outline-button" onClick={signOut} disabled={busy}>Keluar akun</button></div> :
                <form className="auth-form" onSubmit={signIn}><label htmlFor="pilot-email">Alamat email</label><input id="pilot-email" name="email" type="email" placeholder="email@perusahaan.com" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required/>
                  <label htmlFor="pilot-password">Kata sandi</label><input id="pilot-password" name="password" type="password" autoComplete="current-password" placeholder="Minimal 8 karakter" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required/>
                  <button type="submit" className="primary-button" disabled={!config?.configured || busy}>{busy ? 'Memproses...' : 'Masuk'} <Icon name="arrow"/></button>
                  <p>Pilot hanya melalui undangan. Registrasi publik belum dibuka.</p>
                </form>}
              {!config?.configured && <p className="auth-message">Autentikasi masih menunggu konfigurasi staging.</p>}
              {authMessage && <p role="status" className="auth-message">{authMessage}</p>}
            </section>
            <section className="surface security-panel"><div className="panel-heading"><h2>Safety controls</h2><Icon name="shield"/></div>
              {['Broker live tidak terhubung', 'RLS per akun member', 'Deposit dan withdrawal off', 'Data performa tanpa estimasi'].map(s => <div className="security-line" key={s}><span className="tick">✓</span>{s}</div>)}
            </section>
          </aside>
        </div>
      </main>
      <footer className="footer"><span>© 2026 TRADEVICE COPY</span><span>Staging · Paper only · No real money</span></footer>
    </div>

    <nav className="bottom-nav" aria-label="Navigasi mobile">
      <span className="bottom-liquid-indicator" aria-hidden="true" style={{ transform: `translate3d(${(moreOpen || extra.includes(page) ? 4 : Math.max(0, primary.indexOf(page))) * 100}%, 0, 0)` }}>
        <span className="bottom-liquid-highlight" key={moreOpen || extra.includes(page) ? 'More' : page} />
      </span>
      {navigation.filter(item => primary.includes(item.key)).map(item => <button key={item.key} type="button" onClick={() => visit(item.key)} className={'bottom-item' + (page === item.key ? ' is-active' : '')} aria-current={page === item.key ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span></button>)}
      <button type="button" className={'bottom-item' + (extra.includes(page) || moreOpen ? ' is-active' : '')} onClick={() => setMoreOpen(x => !x)} aria-expanded={moreOpen} aria-controls="mobile-more-menu"><Icon name="more"/><span>Lainnya</span></button>
    </nav>
    {moreOpen && <><button className="sheet-scrim" type="button" onClick={() => setMoreOpen(false)} aria-label="Tutup menu lainnya"/><div className="more-sheet" id="mobile-more-menu" role="dialog" aria-label="Navigasi lainnya"><div className="sheet-handle"/><strong>Menu lainnya</strong>{navigation.filter(item => extra.includes(item.key)).map(item => <button type="button" key={item.key} onClick={() => visit(item.key)}><Icon name={item.icon}/>{item.label}<Icon name="arrow"/></button>)}<p>Mode paper. Tidak menerima transfer dana.</p><button className="outline-button sheet-close" type="button" onClick={() => setMoreOpen(false)}>Tutup</button></div></>}
  </div>;
}
