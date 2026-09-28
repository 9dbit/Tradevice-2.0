(() => {
  const INTERNAL_SHADOW_TOKEN = 'tradevice-shadow-open-v8';
  const EXNESS_URL = 'https://my.exness.com/accounts/sign-in';
  sessionStorage.setItem('tradeviceApprovalKey', INTERNAL_SHADOW_TOKEN);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => typeof value === 'number' && Number.isFinite(value) ? `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}` : '$—';
  const num = (value, digits = 3) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  const conf = value => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';

  function periodStart(period) {
    const now = new Date();
    if (period === 'D') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'W') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return d;
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function tradeUsd(order) {
    if (typeof order?.result?.pnl_usd === 'number') return order.result.pnl_usd;
    if (order?.lifecycle === 'PROFIT' && typeof order?.plan?.tp_usd === 'number') return Math.abs(order.plan.tp_usd);
    if (order?.lifecycle === 'LOSS' && typeof order?.plan?.sl_usd === 'number') return -Math.abs(order.plan.sl_usd);
    return 0;
  }

  function curvePath(points) {
    if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
    let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  }

  function ensureGrowthHost() {
    const row = document.querySelector('.walletProfitRow');
    if (!row) return null;
    let host = document.getElementById('walletGrowth');
    if (!host) {
      host = document.createElement('div');
      host.id = 'walletGrowth';
      host.className = 'walletGrowth';
      row.appendChild(host);
    }
    return host;
  }

  async function renderGrowth(period = 'D') {
    const host = ensureGrowthHost();
    if (!host) return;
    try {
      const res = await fetch('/api/v1/orders/ledger?limit=500', { cache: 'no-store' });
      if (!res.ok) return;
      const ledger = await res.json();
      const start = periodStart(period).getTime();
      const trades = (ledger.orders || []).filter(order => {
        if (!['PROFIT','LOSS','CLOSED'].includes(order.lifecycle)) return false;
        const t = new Date(order.closed_at || order.created_at || 0).getTime();
        return Number.isFinite(t) && t >= start;
      }).sort((a,b) => new Date(a.closed_at || a.created_at || 0) - new Date(b.closed_at || b.created_at || 0));

      const values = [0];
      for (const trade of trades) values.push(values[values.length - 1] + tradeUsd(trade));
      if (values.length === 1) values.push(0);
      const w = 420, h = 76, padX = 8, padY = 10;
      let min = Math.min(...values), max = Math.max(...values);
      if (min === max) { min -= 1; max += 1; }
      const points = values.map((v,i) => [padX + i * (w - padX * 2) / Math.max(1, values.length - 1), padY + (max - v) * (h - padY * 2) / (max - min)]);
      const line = curvePath(points);
      const last = points[points.length - 1];
      const fill = `${line} L${last[0].toFixed(2)},${h} L${points[0][0].toFixed(2)},${h} Z`;
      host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="${period} smoothed growth chart"><defs><linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03140a" stop-opacity=".22"/><stop offset="1" stop-color="#03140a" stop-opacity="0"/></linearGradient></defs><line class="growthGrid" x1="0" y1="${h/2}" x2="${w}" y2="${h/2}"/><path class="growthFill" d="${fill}"/><path class="growthLine" d="${line}"/><circle class="growthDot" cx="${last[0]}" cy="${last[1]}" r="3.2"/>${trades.length ? '' : '<text class="growthEmpty" x="12" y="22">No closed trades in this period yet</text>'}</svg>`;
    } catch {}
  }

  function ensureModal() {
    let modal = document.getElementById('thesisModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'thesisModal';
    modal.className = 'thesisModal';
    modal.innerHTML = '<section class="thesisSheet" role="dialog" aria-modal="true" aria-label="Trade plan thesis"><div id="thesisBody"></div></section>';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest("[data-modal-close]")) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById('thesisModal');
    if (modal) modal.classList.remove('open');
    document.body.classList.remove('modalOpen');
  }

  async function openPlan(planId) {
    try {
      const res = await fetch('/api/v1/plans?limit=50', { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      const p = (payload.plans || []).find(x => x.plan_id === planId);
      if (!p) return;
      const pv = p.plan || {};
      const reasons = (p.reason_codes || []).map(r => `<span>${esc(String(r).replaceAll('_',' '))}</span>`).join('') || '<span>No reason codes</span>';
      const card = document.querySelector(`.planCard[data-plan-id="${CSS.escape(planId)}"]`);
      const canManual = !!card?.querySelector('button[data-action="approve"]');
      const modal = ensureModal();
      modal.querySelector('#thesisBody').innerHTML = `<div class="thesisTop"><div><small>Trade plan analysis</small><h3>XAUUSD · ${esc(p.side)} ${esc(String(p.order_type||'').replaceAll('_',' '))}</h3></div><button class="modalClose" data-modal-close aria-label="Close">×</button></div><div class="thesisBadges"><span>${esc(String(p.setup||'').replaceAll('_',' '))}</span><span>${esc(String(p.regime||'').replaceAll('_',' '))}</span><span>Entry ${conf(p.entry_confidence)}</span><span>Decision ${conf(p.decision_confidence)}</span></div><div class="thesisGrid"><div><span>Entry</span><strong>${num(p.entry)}</strong></div><div><span>Take Profit</span><strong class="green">${num(p.take_profit)}</strong></div><div><span>Stop Loss</span><strong class="red">${num(p.stop_loss)}</strong></div><div><span>R:R</span><strong>${typeof pv.rr==='number'?`1:${pv.rr.toFixed(2)}`:'—'}</strong></div><div><span>Lot</span><strong>${typeof pv.lot==='number'?pv.lot.toFixed(2):'0.01'}</strong></div><div><span>Expires</span><strong>${p.expiration_candles ?? '—'} M1</strong></div></div><div class="detailBlock"><label>Thesis</label><p>${esc(p.thesis || 'No thesis supplied.')}</p></div><div class="detailBlock"><label>Invalidation</label><p>${esc(p.invalidation || 'No invalidation note supplied.')}</p></div><div class="detailBlock"><label>Reason codes</label><div class="reasonList">${reasons}</div></div>${canManual?`<div class="modalActions"><button class="modalReject" data-modal-action="reject">Reject</button><button class="modalApprove" data-modal-action="approve">Approve</button></div>`:''}`;
      modal.querySelectorAll('[data-modal-action]').forEach(button => button.addEventListener('click', () => {
        card?.querySelector(`button[data-action="${button.dataset.modalAction}"]`)?.click();
        closeModal();
      }));
      modal.classList.add('open');
      document.body.classList.add('modalOpen');
    } catch {}
  }

  function enhanceCards() {
    document.querySelectorAll('.planCard[data-plan-id]:not(.placeholder)').forEach(card => {
      if (card.dataset.analysisReady === '1') return;
      card.dataset.analysisReady = '1';
      const button = document.createElement('button');
      button.className = 'analysisRead';
      button.type = 'button';
      button.textContent = 'Read thesis / analysis';
      button.addEventListener('pointerdown', () => button.classList.add('pointerPressed'), { passive: true });
      button.addEventListener('pointerup', () => button.classList.remove('pointerPressed'), { passive: true });
      button.addEventListener('pointercancel', () => button.classList.remove('pointerPressed'), { passive: true });
      button.addEventListener('click', () => openPlan(card.dataset.planId));
      const actions = card.querySelector('.planActions');
      card.insertBefore(button, actions || null);
    });
  }

  document.addEventListener('click', event => {
    const action = event.target.closest('.walletAction');
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.open(EXNESS_URL, '_blank', 'noopener,noreferrer');
  }, true);

  document.addEventListener('click', event => {
    const period = event.target.closest('[data-profit-period]');
    if (period) setTimeout(() => renderGrowth(period.dataset.profitPeriod), 10);
  });

  document.addEventListener('DOMContentLoaded', () => {
    ensureModal();
    ensureGrowthHost();
    renderGrowth('D');
    const grid = document.getElementById('planGrid');
    if (grid) new MutationObserver(enhanceCards).observe(grid, { childList: true, subtree: true });
    enhanceCards();
    setInterval(() => {
      const active = document.querySelector('[data-profit-period].active')?.dataset.profitPeriod || 'D';
      renderGrowth(active);
      enhanceCards();
    }, 15000);
  });
})();
