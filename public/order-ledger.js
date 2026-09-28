(() => {
  const css = `
    .analysisPanel,.ordersPanel{overflow:hidden}
    .analysisWrap{padding:12px;display:grid;gap:10px;max-height:430px;overflow:auto}
    .analysisCard{border:1px solid var(--line);background:#0b1810;border-radius:12px;padding:12px}
    .analysisTop{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .analysisDecision{font-size:13px;font-weight:820;letter-spacing:-.01em}
    .analysisMeta{font-size:9px;color:var(--muted);margin-top:3px}
    .analysisTags{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
    .tag{display:inline-flex;padding:4px 7px;border-radius:999px;border:1px solid var(--line2);font-size:8px;color:var(--muted);font-weight:760}
    .tag.ai{color:var(--green);border-color:rgba(83,242,143,.32)}
    .tag.wait{color:var(--amber);border-color:rgba(255,216,117,.28)}
    .tag.pending{color:var(--green3)}
    .analysisCopy{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
    .analysisBlock{border-top:1px solid var(--line);padding-top:9px}
    .analysisBlock b{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:4px}
    .analysisBlock p{margin:0;font-size:10px;line-height:1.5;color:#dcebe1}
    .analysisFoot{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;color:var(--muted);font-size:9px}
    .ordersHead{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 15px;border-bottom:1px solid var(--line)}
    .ordersHint{font-size:10px;color:var(--muted)}
    .ordersWrap{overflow:auto;max-height:360px}
    .ordersTable{width:100%;border-collapse:collapse;min-width:980px}
    .ordersTable th{position:sticky;top:0;z-index:2;background:#0a160f;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.09em;text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}
    .ordersTable td{font-size:10px;padding:11px 12px;border-bottom:1px solid rgba(29,58,41,.75);vertical-align:top;color:#dcebe1}
    .ordersTable tr:last-child td{border-bottom:0}
    .ordersTable tr:hover td{background:rgba(83,242,143,.025)}
    .orderId{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--muted);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .orderMain{font-weight:780;font-size:11px}.orderSub{color:var(--muted);font-size:9px;margin-top:3px}
    .badge{display:inline-flex;align-items:center;padding:4px 7px;border-radius:999px;border:1px solid var(--line2);font-size:9px;font-weight:800;white-space:nowrap}
    .badge.approved,.badge.profit{color:var(--green);border-color:rgba(83,242,143,.35);background:rgba(83,242,143,.05)}
    .badge.rejected,.badge.loss{color:var(--red);border-color:rgba(255,139,139,.35);background:rgba(255,139,139,.04)}
    .badge.floating,.badge.awaiting,.badge.pending{color:var(--amber);border-color:rgba(255,216,117,.3);background:rgba(255,216,117,.04)}
    .badge.expired,.badge.cancelled,.badge.closed{color:var(--muted)}
    .reviewReasons{font-size:9px;color:var(--muted);line-height:1.45;margin-top:5px;max-width:220px}
    .pnlPositive{color:var(--green);font-weight:800}.pnlNegative{color:var(--red);font-weight:800}.pnlNeutral{color:var(--muted)}
    .emptyOrders{padding:28px 16px;text-align:center;color:var(--muted);font-size:11px}
    @media(max-width:720px){.ordersHint{display:none}.ordersWrap{max-height:420px}.analysisCopy{grid-template-columns:1fr}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const aiPanel = document.createElement('section');
  aiPanel.className = 'panel analysisPanel';
  aiPanel.innerHTML = `
    <div class="ordersHead">
      <div>
        <div class="sectionTitle">AI Analysis Stream</div>
        <div class="ordersHint">Structured Astra decisions for every researched M1 snapshot, including WAIT outcomes.</div>
      </div>
      <div class="chip live"><span>GPT-6 ASTRA</span><strong>LIVE</strong></div>
    </div>
    <div class="analysisWrap" id="analysisWrap"><div class="emptyOrders">Waiting for AI analysis.</div></div>
  `;

  const panel = document.createElement('section');
  panel.className = 'panel ordersPanel';
  panel.innerHTML = `
    <div class="ordersHead">
      <div>
        <div class="sectionTitle">Pending Order Review & Trade Ledger</div>
        <div class="ordersHint">Every proposal remains in the ledger after agent review, fill, floating state, and final outcome.</div>
      </div>
      <div class="chip"><span>REVIEW AGENT</span><strong>ACTIVE</strong></div>
    </div>
    <div class="ordersWrap" id="ordersWrap"><div class="emptyOrders">No pending-order proposals yet.</div></div>
  `;

  const footer = document.querySelector('.footer');
  if (footer?.parentNode) {
    footer.parentNode.insertBefore(aiPanel, footer);
    footer.parentNode.insertBefore(panel, footer);
  } else {
    document.querySelector('.app')?.appendChild(aiPanel);
    document.querySelector('.app')?.appendChild(panel);
  }

  function n(value, digits = 3) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function dt(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function reviewCell(order) {
    const status = order.review?.status || 'PENDING_REVIEW';
    const klass = status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : 'awaiting';
    const reasons = Array.isArray(order.review?.reasons) && order.review.reasons.length
      ? order.review.reasons.map(esc).join(' · ')
      : status === 'APPROVED' ? 'Policy checks passed' : 'Awaiting review';
    return `<span class="badge ${klass}">${esc(status.replaceAll('_',' '))}</span><div class="reviewReasons">${reasons}</div>`;
  }

  function resultCell(order) {
    const status = order.lifecycle || 'PENDING';
    const klass = status.toLowerCase();
    let detail = '';
    if (status === 'FLOATING' && order.floating) {
      const r = order.floating.pnl_r;
      const pts = order.floating.points;
      const signClass = typeof r === 'number' ? (r > 0 ? 'pnlPositive' : r < 0 ? 'pnlNegative' : 'pnlNeutral') : 'pnlNeutral';
      detail = `<div class="orderSub ${signClass}">${typeof pts === 'number' ? `${pts >= 0 ? '+' : ''}${pts.toFixed(1)} pt` : '—'}${typeof r === 'number' ? ` · ${r >= 0 ? '+' : ''}${r.toFixed(2)}R` : ''}</div>`;
    } else if (order.result) {
      const r = order.result.pnl_r;
      const usd = order.result.pnl_usd;
      const signClass = typeof r === 'number' ? (r > 0 ? 'pnlPositive' : r < 0 ? 'pnlNegative' : 'pnlNeutral') : 'pnlNeutral';
      detail = `<div class="orderSub ${signClass}">${typeof usd === 'number' ? `${usd >= 0 ? '+' : ''}$${usd.toFixed(2)}` : ''}${typeof r === 'number' ? `${typeof usd === 'number' ? ' · ' : ''}${r >= 0 ? '+' : ''}${r.toFixed(2)}R` : ''}</div>`;
    }
    return `<span class="badge ${klass}">${esc(status)}</span>${detail}`;
  }

  function renderAnalyses(items) {
    const wrap = document.getElementById('analysisWrap');
    if (!wrap) return;
    if (!items?.length) {
      wrap.innerHTML = '<div class="emptyOrders">Waiting for AI analysis.</div>';
      return;
    }
    wrap.innerHTML = items.slice(0, 30).map(item => {
      const isAi = item.source === 'AI';
      const triggers = (item.trigger_codes || []).map(x => `<span class="tag">${esc(x.replaceAll('_',' '))}</span>`).join('');
      const reasons = (item.reason_codes || []).map(x => `<span class="tag">${esc(x.replaceAll('_',' '))}</span>`).join('');
      const confidence = typeof item.confidence === 'number' ? `${Math.round(item.confidence * 100)}%` : '—';
      const market = item.market || {};
      const thesis = item.thesis || (isAi ? 'No thesis text stored.' : 'Prefilter stopped this candle before an AI call.');
      const invalidation = item.invalidation || (isAi ? 'No invalidation text stored.' : (item.prefilter_reasons || []).join(' · ') || 'No setup trigger.');
      return `<div class="analysisCard">
        <div class="analysisTop">
          <div><div class="analysisDecision">${esc(item.decision)}${item.side ? ` · ${esc(item.side)}` : ''}</div><div class="analysisMeta">${dt(item.market_timestamp || item.created_at)} · ${esc(item.model || 'deterministic prefilter')}</div></div>
          <span class="badge ${item.decision === 'PLACE_PENDING' ? 'approved' : item.decision === 'WAIT' ? 'awaiting' : 'closed'}">${esc(item.source)}</span>
        </div>
        <div class="analysisTags"><span class="tag ${isAi ? 'ai' : ''}">${esc(item.regime || 'NO REGIME')}</span><span class="tag">CONF ${confidence}</span>${triggers}${reasons}</div>
        <div class="analysisCopy"><div class="analysisBlock"><b>Thesis</b><p>${esc(thesis)}</p></div><div class="analysisBlock"><b>Invalidation / Why no entry</b><p>${esc(invalidation)}</p></div></div>
        <div class="analysisFoot"><span>Session ${esc(market.session || '—')}</span><span>Trend ${esc(market.trend_alignment || '—')}</span><span>Vol ${esc(market.volatility || '—')}</span><span>Spread ${market.spread_points ?? '—'} pt</span><span>Review ${esc(item.review?.status || '—')}</span></div>
      </div>`;
    }).join('');
  }

  function render(orders) {
    const wrap = document.getElementById('ordersWrap');
    if (!wrap) return;
    if (!orders?.length) {
      wrap.innerHTML = '<div class="emptyOrders">No pending-order proposals yet. New AI proposals will appear here automatically.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="ordersTable">
        <thead><tr>
          <th>Created</th><th>Review Agent</th><th>Order</th><th>Setup / Regime</th>
          <th>Entry</th><th>SL</th><th>TP</th><th>Trade Result</th><th>Record</th>
        </tr></thead>
        <tbody>${orders.map(order => `
          <tr>
            <td>${dt(order.created_at)}<div class="orderSub">${order.closed_at ? `Closed ${dt(order.closed_at)}` : 'Open record'}</div></td>
            <td>${reviewCell(order)}</td>
            <td><div class="orderMain">${esc(order.side || '—')} · ${esc(order.order_type || 'PENDING')}</div><div class="orderSub">Confidence ${typeof order.confidence === 'number' ? `${Math.round(order.confidence * 100)}%` : '—'}</div></td>
            <td><div class="orderMain">${esc(order.setup || '—')}</div><div class="orderSub">${esc(order.regime || '—')}</div></td>
            <td>${n(order.entry)}</td><td>${n(order.stop_loss)}</td><td>${n(order.take_profit)}</td>
            <td>${resultCell(order)}</td>
            <td><div class="orderId" title="${esc(order.trade_id)}">${esc(order.trade_id)}</div><div class="orderSub">${esc(order.mode || 'shadow')}</div></td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  async function refreshLedger() {
    try {
      const response = await fetch('/api/v1/orders/ledger?limit=100', { cache:'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      renderAnalyses(data.analyses || []);
      render(data.orders || []);
    } catch (error) {
      const wrap = document.getElementById('ordersWrap');
      if (wrap) wrap.innerHTML = `<div class="emptyOrders">Order ledger unavailable · ${esc(error.message)}</div>`;
    }
  }

  refreshLedger();
  setInterval(refreshLedger, 10000);
})();
