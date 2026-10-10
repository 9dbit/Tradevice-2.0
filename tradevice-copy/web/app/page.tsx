'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { authErrorMessage, canApplySessionResult, readItems } from '../lib/member-contract.mjs';
import type { PublicConfig } from '../lib/runtime.mjs';

type Item = { id: string; [key: string]: unknown };
const menu = ['Overview', 'Accounts', 'Strategies', 'Trading', 'Funding', 'Referral'] as const;

export default function Home() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [apiStatus, setApiStatus] = useState('Checking');
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [dataError, setDataError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [page, setPage] = useState<string>('Overview');
  const [accounts, setAccounts] = useState<Item[]>([]);
  const [strategies, setStrategies] = useState<Item[]>([]);
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
          // Keep this callback synchronous: Auth methods here can deadlock the SDK.
          if (disposed) return;
          const nextId = nextSession?.user.id ?? null;
          if (identity.current !== nextId || !nextSession) {
            identity.current = nextId;
            epoch.current += 1;
            setAccounts([]); setStrategies([]); setVerified(false); setHasMore(false);
            setDataError('');
          }
          setSession(nextSession);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch {
        if (!disposed) setAuthMessage('Authentication configuration is unavailable. Please reload.');
      }
    }
    void initialize();
    fetch('/api/status', { cache: 'no-store', signal: controller.signal })
      .then(r => r.json()).then(data => { if (!disposed) setApiStatus(data.status); })
      .catch(() => { if (!disposed) setApiStatus('Unavailable'); });
    return () => { disposed = true; controller.abort(); unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!session?.access_token || !client) { setLoading(false); return; }
    const currentEpoch = epoch.current;
    const controller = new AbortController();
    setLoading(true); setVerified(false); setDataError(''); setAccounts([]); setStrategies([]);
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
        const [a, s] = await Promise.all([read('accounts'), read('strategies')]);
        const own = readItems(a); const catalogue = readItems(s);
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) {
          setAccounts(own); setStrategies(catalogue); setHasMore(a.next_offset != null); setVerified(true);
        }
      } catch {
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) {
          setAccounts([]); setStrategies([]); setVerified(false);
          setDataError('Member data unavailable. No balances or account counts have been inferred. Please retry.');
        }
      } finally {
        if (!controller.signal.aborted && canApplySessionResult(currentEpoch, epoch.current)) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [session?.access_token, session?.user.id, client, refresh]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !config?.configured || busy) return;
    setBusy(true); setAuthMessage('');
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setAuthMessage(authErrorMessage(error)); return; }
      setPassword('');
    } catch { setAuthMessage('Authentication is temporarily unavailable. Please retry.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!client || busy) return;
    epoch.current += 1; setAccounts([]); setStrategies([]); setVerified(false); setLoading(false);
    setBusy(true); setAuthMessage('');
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) { setAuthMessage('Sign-out could not be confirmed. Please retry.'); return; }
      identity.current = null; setSession(null); setPassword(''); setDataError('');
    } catch { setAuthMessage('Sign-out could not be confirmed. Please retry.'); }
    finally { setBusy(false); }
  }

  return <main>
    <header><div><h1>TRADEVICE COPY</h1><small>Member research portal / Staging</small></div><span className="pill">PAPER ONLY</span></header>
    <section className="panel"><h2>Trading Engine Foundation</h2><p>Live execution is disabled. This staging platform does not accept or move money.</p><p className="muted">API: {apiStatus} | Supabase: {config?.configured ? 'Configured' : 'Not connected'}</p></section>
    <nav className="tabs" aria-label="Member sections">{menu.map(t => <button key={t} onClick={() => setPage(t)} aria-pressed={page === t}>{t}</button>)}</nav>
    <section className="panel" aria-label={page}><h2>{page}</h2>
      {loading && <p role="status">Verifying session and loading member data...</p>}
      {dataError && <p role="alert" className="warning">{dataError} <button onClick={() => setRefresh(x => x + 1)}>Retry data</button></p>}
      {page === 'Overview' && <div className="tiles">{['Account Equity', 'Profit / Loss', 'Drawdown', 'Copy Status'].map(k => <div className="tile" key={k}><span>{k}</span><strong>{k === 'Copy Status' ? 'Disabled' : 'Not available'}</strong></div>)}</div>}
      {page === 'Accounts' && (verified ? <><p>{accounts.length} read-only linked accounts{hasMore ? ' on this page' : ''}</p>{accounts.map(a => <article className="tile" key={a.id}><span>Paper account</span><strong>{String(a.external_account_id ?? a.id)}</strong><small>Environment: {String(a.environment ?? 'unknown')}</small></article>)}{hasMore && <p>Showing the first 50 accounts. Additional pages are available through the API.</p>}</> : !loading && !dataError && <p>Sign in to view your broker accounts.</p>)}
      {page === 'Strategies' && (verified ? <><p>{strategies.length} research strategies available</p>{strategies.map(s => <article className="tile" key={s.id}><strong>{String(s.code ?? s.id)}</strong><small>{String(s.symbol ?? '')} / Research only</small><p><button disabled>Live subscription unavailable</button></p></article>)}</> : !loading && !dataError && <p>Sign in to view strategies.</p>)}
      {page === 'Trading' && <p>Live copy execution is disabled. Broker execution and the paper simulator are not connected to this portal.</p>}
      {page === 'Funding' && <><p>Funding integration is unavailable. Do not send funds to this platform.</p><div className="tabs"><button disabled>Deposit through broker</button><button disabled>Withdraw through broker</button></div></>}
      {page === 'Referral' && <p>IB attribution and commissions are not enabled.</p>}
    </section>
    <section className="panel"><h2>Member Access</h2>
      {session ? <><p>{verified ? 'Verified member session' : 'Member session: verification pending'}</p><button onClick={signOut} disabled={busy}>Sign out</button></> : <form className="auth" onSubmit={signIn}>
        <label>Email<input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required /></label>
        <button type="submit" disabled={!config?.configured || busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <button type="button" disabled>Sign up</button><small>Invite-only pilot. Public registration is not available in this portal.</small>
      </form>}
      {authMessage && <p role="status" className="warning">{authMessage}</p>}
    </section>
    <footer className="muted">Research only. No live orders, no deposits, no withdrawals.</footer>
  </main>;
}
