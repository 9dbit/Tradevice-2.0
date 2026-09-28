(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = (value, digits = 3) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  const dt = value => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString([], {month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  };
  const sign = (value, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(digits)}` : '—';
  const conf = value => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const closedStates = new Set(['PROFIT','LOSS','EXPIRED','CANCELLED','CLOSED','REJECTED']);
  let lastOrders = [];
  let orderFilter = 'ALL';

  function statusClass(status) {
    if (['PROFIT','APPROVED','CONNECTED','ONLINE'].includes(status)) return 'ok';
    if (['LOSS','REJECTED','STALE'].includes(status)) return 'bad';
    return 'warn';
  }

  function setDecision(decision, side) {
    const el = $('decisionValue');
    if (!el) return;
    el.textContent = decision || 'WAIT';
    el.className = 'decisionValue';
    if (decision === 'PLACE_PENDING' && side === 'BUY') el.classList.add('buy');
    else if (decision === 'PLACE_PENDING' && side === 'SELL') el.classList.add('sell');
    else el.classList.add('wait');
  }

  function renderMarket(dashboard, status) {
    const market = dashboard?.market || {};
    const feed = dashboard?.feed || {};
    setText('bid', num(market.bid));
    setText('ask', num(market.ask));
    setText('spread', typeof market.spread_points === 'number' ? market.spread_points.toFixed(0) : '—');
    setText('feedState', feed.state || 'WAIT');
    setText('feedAge', typeof feed.age_seconds === 'number' ? `${feed.age_seconds}s ago` : 'No snapshot');
    setText('aiWorker', status?.ai_decision_enabled ? 'ON' : 'OFF');
    setText('aiModel', status?.ai_model || 'Decision engine');
    setText('chartPrice', market.bid ? `XAUUSD ${num(market.bid)}` : 'XAUUSD —');
    setText('chartMeta', `${feed.state || 'WAIT'} · spread ${typeof market.spread_points === 'number' ? market.spread_points.toFixed(0) : '—'} pt`);
    const pill = $('servicePill');
    if (pill) pill.innerHTML = `<span class="dot"></span> ${feed.state === 'CONNECTED' ? 'ONLINE' : esc(feed.state || 'CHECK')}`;
  }

  function renderPerformance(dashboard, orders, analyses) {
    const p = dashboard?.performance || {};
    setText('closedTrades', String(p.closed_trades ?? 0));
    setText('winRate', typeof p.win_rate === 'number' ? `${(p.win_rate * 100).toFixed(1)}%` : '—');
    setText('expectancy', typeof p.expectancy_r === 'number' ? `${sign(p.expectancy_r)}R` : '—');
    setText('profitFactor', typeof p.profit_factor === 'number' ? p.profit_factor.toFixed(2) : '—');
    const open = (orders || []).filter(o => !closedStates.has(o.lifecycle || 'PENDING')).length;
    setText('pendingCount', String(open));
    setText('analysisCount', String((analyses || []).length));
  }

  function clearPlanPrices() {
    setText('entry', '—'); setText('tp', '—'); setText('sl', '—'); setText('rr', '—');
    setText('tpPips', '—'); setText('tpUsd', '—'); setText('slPips', '—'); setText('slUsd', '—');
    setText('floating', '—'); setText('floatingSub', 'No fill');
  }

  function renderPlan(orders, analyses, shadowLot) {
    const activeOrder = (orders || []).find(o => !closedStates.has(o.lifecycle || 'PENDING')) || null;
    const latest = analyses?.[0] || null;
    const lot = activeOrder?.plan?.lot ?? shadowLot ?? 0.01;
    setText('lot', typeof lot === 'number' ? lot.toFixed(2) : '0.01');

    if (!activeOrder) {
      const decision = latest?.decision || 'WAIT';
      setDecision(decision, latest?.side);
      setText('decisionConfidence', conf(latest?.decision_confidence ?? latest?.confidence));
      setText('entryConfidence', conf(latest?.entry_confidence));
      setText('orderType', latest?.order_type || '—');
      setText('setupRegime', [latest?.setup, latest?.regime].filter(Boolean).join(' · ') || 'No executable setup');
      clearPlanPrices();
      setText('planMeta', latest ? `${latest.source || 'AI'} · ${dt(latest.market_timestamp || latest.created_at)}` : 'Latest Astra decision');
      setText('planLifecycle', decision === 'WAIT' ? 'WAIT' : decision);
      const lifecycle = $('planLifecycle'); if (lifecycle) lifecycle.className = 'status warn';
      setText('reviewState', latest?.source === 'AI' ? 'Astra' : 'Prefilter');
      const threshold = typeof latest?.entry_pending_threshold === 'number' ? Math.round(latest.entry_pending_threshold * 100) : 80;
      const reason = latest?.thesis || latest?.prefilter_reasons?.join(' · ') || `Entry confidence must reach ${threshold}% with valid price structure.`;
      setText('reviewReason', reason);
      const badge = $('reviewBadge');
      if (badge) { badge.textContent = decision; badge.className = 'reviewBadge wait'; }
      return;
    }

    const order = activeOrder;
    const plan = order.plan || {};
    setDecision('PLACE_PENDING', order.side);
    setText('decisionConfidence', conf(order.decision_confidence ?? order.confidence));
    setText('entryConfidence', conf(order.entry_confidence));
    setText('orderType', order.order_type || '—');
    setText('setupRegime', [order.setup, order.regime].filter(Boolean).join(' · ') || '—');
    setText('entry', num(order.entry));
    setText('tp', num(order.take_profit));
    setText('sl', num(order.stop_loss));
    setText('rr', typeof plan.rr === 'number' ? `1:${plan.rr.toFixed(2)}` : '—');
    setText('tpPips', typeof plan.tp_pips === 'number' ? `${plan.tp_pips.toFixed(1)} pips · ${Math.round(plan.tp_points || 0)} pt` : '—');
    setText('tpUsd', typeof plan.tp_usd === 'number' ? `+$${Math.abs(plan.tp_usd).toFixed(2)}` : '$—');
    setText('slPips', typeof plan.sl_pips === 'number' ? `${plan.sl_pips.toFixed(1)} pips · ${Math.round(plan.sl_points || 0)} pt` : '—');
    setText('slUsd', typeof plan.sl_usd === 'number' ? `-$${Math.abs(plan.sl_usd).toFixed(2)}` : '$—');
    setText('planMeta', `${order.side || ''} ${order.order_type || ''} · ${dt(order.created_at)}`);
    setText('planLifecycle', order.lifecycle || 'PENDING');
    const lifecycle = $('planLifecycle'); if (lifecycle) lifecycle.className = `status ${statusClass(order.lifecycle)}`;
    if (order.floating) {
      setText('floating', `${sign(order.floating.pnl_r)}R`);
      setText('floatingSub', `${sign(order.floating.points, 1)} pt · ${num(order.floating.mark_price)}`);
    } else {
      setText('floating', '—'); setText('floatingSub', 'Pending fill');
    }
    const reviewStatus = order.review?.status || 'PENDING_REVIEW';
    setText('reviewState', 'Review Agent');
    setText('reviewReason', order.review?.reasons?.join(' · ') || (reviewStatus === 'APPROVED' ? 'Entry confidence and risk policy passed' : 'Awaiting review'));
    const badge = $('reviewBadge');
    if (badge) { badge.textContent = reviewStatus.replaceAll('_',' '); badge.className = `reviewBadge ${reviewStatus === 'APPROVED' ? 'approved' : reviewStatus === 'REJECTED' ? 'rejected' : 'wait'}`; }
  }

  function filterOrders(orders) {
    if (orderFilter === 'PENDING') return orders.filter(o => ['PENDING','AWAITING_REVIEW'].includes(o.lifecycle));
    if (orderFilter === 'FLOATING') return orders.filter(o => o.lifecycle === 'FLOATING');
    if (orderFilter === 'CLOSED') return orders.filter(o => closedStates.has(o.lifecycle));
    return orders;
  }

  function renderOrders(orders) {
    const wrap = $('ordersWrap'); if (!wrap) return;
    const items = filterOrders(orders || []);
    if (!items.length) { wrap.innerHTML = '<div class="empty"><b>No records in this view</b>Orders remain permanently available under All.</div>'; return; }
    wrap.innerHTML = `<table class="tradeTable"><thead><tr><th>Time</th><th>Status</th><th>Side / Type</th><th>Lot</th><th>Entry</th><th>TP</th><th>TP pips / $</th><th>SL</th><th>SL pips / $</th><th>R:R</th><th>D conf</th><th>Entry conf</th><th>Review</th><th>P/L</th></tr></thead><tbody>${items.map(o => {
      const plan=o.plan||{}; const life=o.lifecycle||'PENDING'; const pnl=o.floating?.pnl_r ?? o.result?.pnl_r;
      return `<tr>
        <td data-label="Time">${dt(o.created_at)}</td>
        <td data-label="Status"><span class="status ${statusClass(life)}">${esc(life)}</span></td>
        <td data-label="Side / Type" class="num ${o.side==='BUY'?'green':'red'}">${esc(o.side||'—')}<div class="muted">${esc(o.order_type||'—')}</div></td>
        <td data-label="Lot" class="num">${typeof plan.lot==='number'?plan.lot.toFixed(2):'—'}</td>
        <td data-label="Entry" class="num">${num(o.entry)}</td>
        <td data-label="TP" class="num green">${num(o.take_profit)}</td>
        <td data-label="TP pips / $">${typeof plan.tp_pips==='number'?`${plan.tp_pips.toFixed(1)} · ${typeof plan.tp_usd==='number'?`+$${Math.abs(plan.tp_usd).toFixed(2)}`:'$—'}`:'—'}</td>
        <td data-label="SL" class="num red">${num(o.stop_loss)}</td>
        <td data-label="SL pips / $">${typeof plan.sl_pips==='number'?`${plan.sl_pips.toFixed(1)} · ${typeof plan.sl_usd==='number'?`-$${Math.abs(plan.sl_usd).toFixed(2)}`:'$—'}`:'—'}</td>
        <td data-label="R:R" class="num">${typeof plan.rr==='number'?`1:${plan.rr.toFixed(2)}`:'—'}</td>
        <td data-label="Decision conf">${conf(o.decision_confidence ?? o.confidence)}</td>
        <td data-label="Entry conf" class="green">${conf(o.entry_confidence)}</td>
        <td data-label="Review">${esc(o.review?.status||'—')}</td>
        <td data-label="P/L" class="num ${typeof pnl==='number'?(pnl>0?'green':pnl<0?'red':'muted'):'muted'}">${typeof pnl==='number'?`${sign(pnl)}R`:'—'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  function renderAnalyses(items) {
    const wrap = $('analysisWrap'); if (!wrap) return;
    if (!items?.length) { wrap.innerHTML = '<div class="empty">Waiting for analysis records.</div>'; return; }
    wrap.innerHTML = `<table class="aiTable"><thead><tr><th>Time</th><th>Decision</th><th>D conf</th><th>Entry conf</th><th>Regime</th><th>Triggers</th><th>Why</th><th>Source</th></tr></thead><tbody>${items.slice(0,40).map(a => `<tr>
      <td data-label="Time">${dt(a.market_timestamp||a.created_at)}</td>
      <td data-label="Decision" class="aiDecision ${esc(a.decision)}">${esc(a.decision)}</td>
      <td data-label="Decision conf">${conf(a.decision_confidence ?? a.confidence)}</td>
      <td data-label="Entry conf" class="green">${conf(a.entry_confidence)}</td>
      <td data-label="Regime">${esc(a.regime||'—')}</td>
      <td data-label="Triggers">${esc((a.trigger_codes||a.reason_codes||[]).slice(0,3).join(' · ')||'—')}</td>
      <td data-label="Why" data-wide="1" class="thesis">${esc(a.thesis||a.prefilter_reasons?.join(' · ')||'No AI call')}</td>
      <td data-label="Source">${esc(a.source||'—')}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  function bindControls() {
    document.querySelectorAll('.tab[data-filter]').forEach(btn => btn.addEventListener('click', () => {
      orderFilter = btn.dataset.filter || 'ALL';
      document.querySelectorAll('.tab[data-filter]').forEach(x => x.classList.toggle('active', x === btn));
      renderOrders(lastOrders);
    }));
    document.querySelectorAll('.tool[data-tf]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.tool[data-tf]').forEach(x => x.classList.toggle('active', x === btn));
      const frame = $('marketChart'); if (!frame) return;
      const u = new URL(frame.src); u.searchParams.set('interval', btn.dataset.tf); frame.src = u.toString();
    }));
  }

  async function refresh() {
    try {
      const [dashboardRes,statusRes,ledgerRes] = await Promise.all([
        fetch('/api/v1/dashboard',{cache:'no-store'}), fetch('/api/v1/status',{cache:'no-store'}), fetch('/api/v1/orders/ledger?limit=100',{cache:'no-store'})
      ]);
      if (!dashboardRes.ok || !statusRes.ok || !ledgerRes.ok) throw new Error('Tradevice API unavailable');
      const [dashboard,status,ledger] = await Promise.all([dashboardRes.json(),statusRes.json(),ledgerRes.json()]);
      lastOrders = ledger.orders || [];
      renderMarket(dashboard,status); renderPerformance(dashboard,lastOrders,ledger.analyses); renderPlan(lastOrders,ledger.analyses,ledger.shadow_lot); renderOrders(lastOrders); renderAnalyses(ledger.analyses);
    } catch (error) {
      const pill=$('servicePill'); if(pill) pill.innerHTML='<span class="dot"></span> OFFLINE';
      console.error('Tradevice dashboard refresh failed', error);
    }
  }

  bindControls(); refresh(); setInterval(refresh,5000);
})();
