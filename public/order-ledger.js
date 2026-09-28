(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = (value, digits = 3) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  const pct = value => typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  const dt = value => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString([], {month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  };
  const sign = (value, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(digits)}` : '—';
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

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
    setText('spread', typeof market.spread_points === 'number' ? `${market.spread_points.toFixed(1)} pt` : '—');
    setText('feedState', feed.state || 'WAITING');
    setText('feedAge', typeof feed.age_seconds === 'number' ? `Snapshot ${feed.age_seconds}s ago` : 'Awaiting snapshot');
    setText('aiWorker', status?.ai_decision_enabled ? 'ENABLED' : 'OFF');
    setText('aiModel', status?.ai_model || 'Structured decision engine');
    setText('dbStatus', String(status?.store || '—').toUpperCase());
    setText('bridge', market.bridge_version ? `v${market.bridge_version}` : '—');
    setText('chartPrice', market.bid ? `XAUUSD ${num(market.bid)}` : 'XAUUSD —');
    setText('chartMeta', `${feed.state || 'WAITING'} · Spread ${typeof market.spread_points === 'number' ? market.spread_points.toFixed(1) : '—'} pt`);
    const pill = $('servicePill');
    if (pill) pill.innerHTML = `<span class="dot"></span> ${feed.state === 'CONNECTED' ? 'ONLINE' : esc(feed.state || 'CHECKING')}`;
  }

  function renderPerformance(dashboard, orders, analyses) {
    const p = dashboard?.performance || {};
    setText('closedTrades', String(p.closed_trades ?? 0));
    setText('winRate', typeof p.win_rate === 'number' ? `${(p.win_rate * 100).toFixed(1)}%` : '—');
    setText('expectancy', typeof p.expectancy_r === 'number' ? `${sign(p.expectancy_r)}R` : '—');
    setText('profitFactor', typeof p.profit_factor === 'number' ? p.profit_factor.toFixed(2) : '—');
    setText('pendingCount', String((orders || []).length));
    setText('analysisCount', String((analyses || []).length));
  }

  function renderPlan(orders, analyses, shadowLot) {
    const order = orders?.[0] || null;
    const latest = analyses?.[0] || null;
    const lot = order?.plan?.lot ?? shadowLot ?? 0.01;
    setText('lot', typeof lot === 'number' ? lot.toFixed(2) : '0.01');

    if (!order) {
      const decision = latest?.decision || 'WAIT';
      setDecision(decision, latest?.side);
      setText('decisionConfidence', typeof latest?.confidence === 'number' ? `${Math.round(latest.confidence * 100)}%` : '—');
      setText('orderType', latest?.order_type || '—');
      setText('setupRegime', [latest?.setup, latest?.regime].filter(Boolean).join(' · ') || 'Awaiting valid setup');
      setText('entry', '—'); setText('tp', '—'); setText('sl', '—'); setText('rr', '—');
      setText('tpPips', '—'); setText('tpUsd', '—'); setText('slPips', '—'); setText('slUsd', '—');
      setText('floating', '—'); setText('floatingSub', 'No filled shadow order');
      setText('planMeta', latest ? `${latest.source || 'AI'} · ${latest.model || 'prefilter'} · ${dt(latest.market_timestamp || latest.created_at)}` : 'Latest Astra decision');
      setText('planLifecycle', decision === 'WAIT' ? 'WAIT' : decision);
      setText('reviewState', latest?.source === 'AI' ? 'Astra Decision' : 'Prefilter');
      setText('reviewReason', latest?.thesis || latest?.prefilter_reasons?.join(' · ') || 'No qualified pending proposal yet');
      const badge = $('reviewBadge');
      if (badge) { badge.textContent = decision; badge.className = 'reviewBadge wait'; }
      return;
    }

    const plan = order.plan || {};
    setDecision('PLACE_PENDING', order.side);
    setText('decisionConfidence', typeof order.confidence === 'number' ? `${Math.round(order.confidence * 100)}%` : '—');
    setText('orderType', order.order_type || '—');
    setText('setupRegime', [order.setup, order.regime].filter(Boolean).join(' · ') || '—');
    setText('entry', num(order.entry));
    setText('tp', num(order.take_profit));
    setText('sl', num(order.stop_loss));
    setText('rr', typeof plan.rr === 'number' ? `1:${plan.rr.toFixed(2)}` : '—');
    setText('tpPips', typeof plan.tp_pips === 'number' ? `${plan.tp_pips.toFixed(1)} pips · ${Math.round(plan.tp_points || 0)} pt` : '—');
    setText('tpUsd', typeof plan.tp_usd === 'number' ? `+$${Math.abs(plan.tp_usd).toFixed(2)}` : 'Awaiting broker spec');
    setText('slPips', typeof plan.sl_pips === 'number' ? `${plan.sl_pips.toFixed(1)} pips · ${Math.round(plan.sl_points || 0)} pt` : '—');
    setText('slUsd', typeof plan.sl_usd === 'number' ? `-$${Math.abs(plan.sl_usd).toFixed(2)}` : 'Awaiting broker spec');
    setText('planMeta', `${order.side || ''} ${order.order_type || ''} · ${dt(order.created_at)}`);
    setText('planLifecycle', order.lifecycle || 'PENDING');
    const lifecycle = $('planLifecycle'); if (lifecycle) lifecycle.className = `status ${statusClass(order.lifecycle)}`;
    if (order.floating) {
      setText('floating', `${sign(order.floating.pnl_r)}R`);
      setText('floatingSub', `${sign(order.floating.points, 1)} pt · mark ${num(order.floating.mark_price)}`);
    } else if (order.result) {
      setText('floating', typeof order.result.pnl_r === 'number' ? `${sign(order.result.pnl_r)}R` : order.lifecycle);
      setText('floatingSub', typeof order.result.pnl_usd === 'number' ? `${sign(order.result.pnl_usd)} USD final` : 'Closed shadow trade');
    } else {
      setText('floating', '—'); setText('floatingSub', 'Pending fill');
    }
    const reviewStatus = order.review?.status || 'PENDING_REVIEW';
    setText('reviewState', 'Review Agent');
    setText('reviewReason', order.review?.reasons?.join(' · ') || (reviewStatus === 'APPROVED' ? 'Policy checks passed' : 'Awaiting policy review'));
    const badge = $('reviewBadge');
    if (badge) { badge.textContent = reviewStatus.replaceAll('_',' '); badge.className = `reviewBadge ${reviewStatus === 'APPROVED' ? 'approved' : reviewStatus === 'REJECTED' ? 'rejected' : 'wait'}`; }
  }

  function renderOrders(orders) {
    const wrap = $('ordersWrap');
    if (!wrap) return;
    if (!orders?.length) {
      wrap.innerHTML = '<div class="empty"><b>No trade proposals yet</b>Astra is still waiting for a qualified setup.</div>';
      return;
    }
    wrap.innerHTML = `<table class="tradeTable"><thead><tr><th>Time</th><th>Status</th><th>Side</th><th>Type</th><th>Lot</th><th>Entry</th><th>TP</th><th>TP pips / $</th><th>SL</th><th>SL pips / $</th><th>R:R</th><th>Confidence</th><th>Review</th><th>P/L</th></tr></thead><tbody>${orders.map(o => {
      const plan=o.plan||{}; const life=o.lifecycle||'PENDING';
      const pnl=o.floating?.pnl_r ?? o.result?.pnl_r;
      const pnlText=typeof pnl==='number'?`${sign(pnl)}R`:'—';
      return `<tr><td>${dt(o.created_at)}</td><td><span class="status ${statusClass(life)}">${esc(life)}</span></td><td class="num ${o.side==='BUY'?'green':'red'}">${esc(o.side||'—')}</td><td>${esc(o.order_type||'—')}</td><td class="num">${typeof plan.lot==='number'?plan.lot.toFixed(2):'—'}</td><td class="num">${num(o.entry)}</td><td class="num green">${num(o.take_profit)}</td><td>${typeof plan.tp_pips==='number'?`${plan.tp_pips.toFixed(1)} · ${typeof plan.tp_usd==='number'?`+$${Math.abs(plan.tp_usd).toFixed(2)}`:'$—'}`:'—'}</td><td class="num red">${num(o.stop_loss)}</td><td>${typeof plan.sl_pips==='number'?`${plan.sl_pips.toFixed(1)} · ${typeof plan.sl_usd==='number'?`-$${Math.abs(plan.sl_usd).toFixed(2)}`:'$—'}`:'—'}</td><td class="num">${typeof plan.rr==='number'?`1:${plan.rr.toFixed(2)}`:'—'}</td><td>${typeof o.confidence==='number'?`${Math.round(o.confidence*100)}%`:'—'}</td><td>${esc(o.review?.status||'—')}</td><td class="num ${typeof pnl==='number'?(pnl>0?'green':pnl<0?'red':'muted'):'muted'}">${pnlText}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function renderAnalyses(items) {
    const wrap = $('analysisWrap');
    if (!wrap) return;
    if (!items?.length) { wrap.innerHTML = '<div class="empty">Waiting for analysis records.</div>'; return; }
    wrap.innerHTML = `<table class="aiTable"><thead><tr><th>Time</th><th>Decision</th><th>Confidence</th><th>Regime</th><th>Triggers</th><th>Thesis</th><th>Source</th></tr></thead><tbody>${items.slice(0,40).map(a => `<tr><td>${dt(a.market_timestamp||a.created_at)}</td><td class="aiDecision ${esc(a.decision)}">${esc(a.decision)}</td><td>${typeof a.confidence==='number'?`${Math.round(a.confidence*100)}%`:'—'}</td><td>${esc(a.regime||'—')}</td><td>${esc((a.trigger_codes||a.reason_codes||[]).slice(0,3).join(' · ')||'—')}</td><td class="thesis">${esc(a.thesis||a.prefilter_reasons?.join(' · ')||'No AI call')}</td><td>${esc(a.source||'—')}</td></tr>`).join('')}</tbody></table>`;
  }

  async function refresh() {
    try {
      const [dashboardRes,statusRes,ledgerRes] = await Promise.all([
        fetch('/api/v1/dashboard',{cache:'no-store'}),
        fetch('/api/v1/status',{cache:'no-store'}),
        fetch('/api/v1/orders/ledger?limit=100',{cache:'no-store'})
      ]);
      if (!dashboardRes.ok || !statusRes.ok || !ledgerRes.ok) throw new Error('Tradevice API unavailable');
      const [dashboard,status,ledger] = await Promise.all([dashboardRes.json(),statusRes.json(),ledgerRes.json()]);
      renderMarket(dashboard,status);
      renderPerformance(dashboard,ledger.orders,ledger.analyses);
      renderPlan(ledger.orders,ledger.analyses,ledger.shadow_lot);
      renderOrders(ledger.orders);
      renderAnalyses(ledger.analyses);
    } catch (error) {
      const pill=$('servicePill'); if(pill) pill.innerHTML='<span class="dot"></span> OFFLINE';
      console.error('Tradevice dashboard refresh failed', error);
    }
  }

  refresh();
  setInterval(refresh, 5000);
})();
