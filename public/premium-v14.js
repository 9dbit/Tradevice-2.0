(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const pct = value => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : '—';
  const dt = value => {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short' });
  };
  let suppressUntil = 0;
  let timer = null;

  function stateClass(state) {
    const value = String(state || '').toUpperCase();
    if (value === 'ARMED' || value === 'CONFIRMED') return 'armed';
    if (value === 'FORMING') return 'forming';
    return 'scanning';
  }

  function stateFromReasons(item) {
    const reasons = item?.reason_codes || [];
    return reasons.find(reason => ['ARMED','FORMING','CONFIRMED','SCANNING'].includes(String(reason).toUpperCase())) || 'FORMING';
  }

  function watchCard(item) {
    const state = stateFromReasons(item);
    const timeframe = (item.reason_codes || []).find(reason => /^M\d+$/i.test(String(reason))) || 'M15';
    const quality = pct(item.confidence);
    return `<article class="strategyWatchCard ${stateClass(state)}">
      <div class="strategyWatchTop"><div><span class="strategyState ${stateClass(state)}">${esc(state)}</span><strong>${esc(String(item.setup || 'Structure watch').replaceAll('_',' '))}</strong></div><div class="strategyQuality"><b>${quality}</b><span>quality</span></div></div>
      <div class="strategyWatchMeta"><span>${esc(timeframe)}</span><span>${esc(item.regime || '—')}</span><span>${dt(item.market_timestamp || item.created_at)}</span></div>
      <p>${esc(item.thesis || 'Structure is being monitored for confirmation.')}</p>
      <div class="strategyWaiting">Waiting for confirmation · no order yet</div>
    </article>`;
  }

  function summaryCard(item, watchCount) {
    const reasons = item?.reason_codes || [];
    const bias = String(reasons.find(reason => String(reason).startsWith('BIAS_')) || 'BIAS_NEUTRAL').replace('BIAS_','').replaceAll('_',' ');
    const m5 = String(reasons.find(reason => String(reason).startsWith('M5_')) || 'M5_UNKNOWN').replace('M5_','');
    const m15 = String(reasons.find(reason => String(reason).startsWith('M15_')) || 'M15_UNKNOWN').replace('M15_','');
    const state = watchCount ? 'MONITORING' : 'SCANNING';
    return `<article class="strategySummaryCard">
      <div class="strategySummaryHead"><div><small>Current market read</small><h3>XAUUSD · ${esc(bias)}</h3></div><span class="strategyPulse">● ${state}</span></div>
      <div class="strategySummaryGrid"><div><span>M5 trend</span><strong>${esc(m5)}</strong></div><div><span>M15 trend</span><strong>${esc(m15)}</strong></div><div><span>Structure watches</span><strong>${watchCount}</strong></div><div><span>Last scan</span><strong>${dt(item.market_timestamp || item.created_at)}</strong></div></div>
      <p>${esc(item.thesis || 'Tradevice is scanning live structure.')}</p>
      <div class="strategyRule">Offering appears only after a detector reaches CONFIRMED and passes risk validation.</div>
    </article>`;
  }

  function confirmedCard(item) {
    const score = pct(item.confidence);
    return `<article class="strategyConfirmedCard">
      <div><span class="strategyState armed">CONFIRMED</span><strong>${esc(String(item.setup || 'Confirmed setup').replaceAll('_',' '))}</strong><small>${dt(item.market_timestamp || item.created_at)}</small></div>
      <b>${score}</b>
    </article>`;
  }

  function updateOfferPlaceholder(summary, watches) {
    const placeholder = document.querySelector('#planGrid .serverEmpty');
    if (!placeholder || !summary) return;
    const p = placeholder.querySelector('.planStory p');
    const tag = placeholder.querySelector('.offerMetaLeft .offerTag:last-child');
    const armed = watches.filter(item => stateFromReasons(item) === 'ARMED').length;
    if (tag) tag.textContent = armed ? `${armed} ARMED WATCH${armed === 1 ? '' : 'ES'}` : watches.length ? `${watches.length} FORMING` : 'LIVE SCANNER';
    if (p) p.textContent = armed
      ? `${armed} structure watch${armed === 1 ? ' is' : 'es are'} armed, but confirmation is not complete yet. No pending-order offer will be created prematurely.`
      : watches.length
        ? `${watches.length} potential structure${watches.length === 1 ? ' is' : 's are'} forming. Tradevice is waiting for the exact confirmation trigger before creating an Offering.`
        : 'Live structure analysis is active. No confirmed pending-order setup is available at this moment.';
  }

  async function renderStrategyAnalysis() {
    const host = document.getElementById('analysisWrap');
    if (!host) return;
    try {
      const response = await fetch('/api/v1/orders/ledger?limit=160', { cache:'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const analyses = payload.analyses || [];
      const summaries = analyses.filter(item => String(item.trade_id || '').startsWith('analysis-scan-'));
      const watchesAll = analyses.filter(item => String(item.trade_id || '').startsWith('analysis-watch-'));
      const summary = summaries[0] || null;
      const summaryTime = summary ? new Date(summary.market_timestamp || summary.created_at || 0).getTime() : 0;
      const watches = watchesAll.filter(item => {
        const time = new Date(item.market_timestamp || item.created_at || 0).getTime();
        return !summaryTime || Math.abs(summaryTime - time) <= 10 * 60 * 1000;
      }).slice(0,5);
      const confirmed = analyses.filter(item => item.decision === 'OFFER' && !String(item.trade_id || '').startsWith('analysis-')).slice(0,4);

      let html = '<div class="strategyAnalysisLive">';
      if (summary) html += summaryCard(summary, watches.length);
      else html += '<article class="strategySummaryCard"><div class="strategySummaryHead"><div><small>Current market read</small><h3>Initializing scanner</h3></div><span class="strategyPulse">● WAITING</span></div><p>Waiting for the next closed M1 snapshot to publish deterministic market analysis.</p></article>';
      html += '<div class="strategySubHead"><div><strong>Setup Watchlist</strong><span>Forming and armed structures</span></div><b>'+watches.length+'</b></div>';
      html += watches.length ? `<div class="strategyWatchGrid">${watches.map(watchCard).join('')}</div>` : '<div class="strategyEmpty">No nearby structure watch right now. Scanner remains active every closed M1 candle.</div>';
      if (confirmed.length) html += `<div class="strategySubHead confirmedHead"><div><strong>Recent Confirmed Events</strong><span>Events that reached offering criteria</span></div></div><div class="strategyConfirmedList">${confirmed.map(confirmedCard).join('')}</div>`;
      html += '</div>';
      suppressUntil = Date.now() + 300;
      host.innerHTML = html;
      updateOfferPlaceholder(summary, watches);
    } catch (error) {
      console.error('strategy analysis render failed', error);
    }
  }

  function boot() {
    const host = document.getElementById('analysisWrap');
    if (!host) return;
    const observer = new MutationObserver(() => {
      if (Date.now() < suppressUntil) return;
      clearTimeout(timer);
      timer = setTimeout(renderStrategyAnalysis, 70);
    });
    observer.observe(host, { childList:true, subtree:false });
    renderStrategyAnalysis();
    setInterval(renderStrategyAnalysis, 5200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
