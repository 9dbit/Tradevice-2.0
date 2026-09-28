(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v,d=3) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
  const conf = v => typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v*100)}%` : '—';
  const shortTime = v => { const d=new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—'; };
  const fmtMoney = v => typeof v === 'number' && Number.isFinite(v) ? `${v>=0?'+':'-'}$${Math.abs(v).toFixed(2)}` : '$—';

  function metric(label,value,cls='') {
    return `<div class="miniMetric"><span class="mk">${esc(label)}</span><strong class="mv ${cls}">${esc(value)}</strong></div>`;
  }

  function floatingUsd(order) {
    const r = Number(order?.floating?.pnl_r);
    const slUsd = Number(order?.plan?.sl_usd);
    if (Number.isFinite(r) && Number.isFinite(slUsd)) return r * slUsd;
    const points = Number(order?.floating?.points);
    const point = Number(order?.plan?.point_size);
    const tickSize = Number(order?.plan?.tick_size);
    const lot = Number(order?.plan?.lot);
    const tickValueProfit = Number(order?.plan?.tick_value_profit);
    const tickValueLoss = Number(order?.plan?.tick_value_loss);
    if (![points,point,tickSize,lot].every(Number.isFinite) || tickSize <= 0) return null;
    const tickValue = points >= 0 ? tickValueProfit : tickValueLoss;
    if (!Number.isFinite(tickValue)) return null;
    return (points * point / tickSize) * tickValue * lot;
  }

  function positionCard(order) {
    const pnlUsd = floatingUsd(order);
    const pnlR = Number(order?.floating?.pnl_r);
    const positive = typeof pnlUsd === 'number' ? pnlUsd >= 0 : Number.isFinite(pnlR) ? pnlR >= 0 : true;
    const sideClass = order.side === 'BUY' ? 'buy' : 'sell';
    const pnlClass = positive ? 'profit' : 'loss';
    return `<article class="tradeStateItem ${positive?'isProfit':'isLoss'}"><div class="tradeMiniGrid">
      <div class="miniMetric positionProfit"><span class="mk">Floating P/L</span><strong class="mv ${pnlClass}">${fmtMoney(pnlUsd)}</strong><span class="subPnl">${Number.isFinite(pnlR)?`${pnlR>=0?'+':''}${pnlR.toFixed(2)}R`:'live position'}</span></div>
      ${metric('Status','OPEN','profit')}${metric('Side',order.side||'—',sideClass)}
      ${metric('Entry',num(order.entry))}${metric('Mark',num(order.floating?.mark_price))}${metric('TP',num(order.take_profit),'profit')}${metric('SL',num(order.stop_loss),'loss')}
      ${metric('Lot',Number.isFinite(Number(order.plan?.lot))?Number(order.plan.lot).toFixed(2):'—')}${metric('R:R',Number.isFinite(Number(order.plan?.rr))?`1:${Number(order.plan.rr).toFixed(2)}`:'—')}${metric('Floating R',Number.isFinite(pnlR)?`${pnlR>=0?'+':''}${pnlR.toFixed(2)}R`:'—',pnlClass)}${metric('Confidence',conf(order.entry_confidence))}
    </div></article>`;
  }

  function orderCard(order) {
    const sideClass = order.side === 'BUY' ? 'buy' : 'sell';
    return `<article class="tradeStateItem"><div class="tradeMiniGrid">
      ${metric('Symbol','XAUUSD')}${metric('Side',order.side||'—',sideClass)}${metric('Order',String(order.order_type||'—').replaceAll('_',' '))}${metric('Status',String(order.lifecycle||'PENDING').replaceAll('_',' '),'profit')}
      ${metric('Entry',num(order.entry))}${metric('TP',num(order.take_profit),'profit')}${metric('SL',num(order.stop_loss),'loss')}${metric('Lot',Number.isFinite(Number(order.plan?.lot))?Number(order.plan.lot).toFixed(2):'—')}
      ${metric('R:R',Number.isFinite(Number(order.plan?.rr))?`1:${Number(order.plan.rr).toFixed(2)}`:'—')}${metric('Confidence',conf(order.entry_confidence))}${metric('Setup',String(order.setup||'—').replaceAll('_',' '))}${metric('Created',shortTime(order.created_at))}
    </div></article>`;
  }

  async function refreshTradeState() {
    const positionsWrap = $('openPositionsWrap');
    const ordersWrap = $('pendingOrdersWrap');
    if (!positionsWrap || !ordersWrap) return;
    try {
      const res = await fetch('/api/v1/orders/ledger?limit=200', {cache:'no-store'});
      if (!res.ok) return;
      const data = await res.json();
      const all = Array.isArray(data.orders) ? data.orders : [];
      const positions = all.filter(o => o.lifecycle === 'FLOATING');
      const pending = all.filter(o => ['PENDING','AWAITING_REVIEW'].includes(o.lifecycle));
      $('openPositionsCount').textContent = `${positions.length} open`;
      $('pendingOrdersCount').textContent = `${pending.length} active`;
      positionsWrap.innerHTML = positions.length ? positions.map(positionCard).join('') : '<div class="tradeEmpty">No open positions.</div>';
      ordersWrap.innerHTML = pending.length ? pending.map(orderCard).join('') : '<div class="tradeEmpty">No pending orders.</div>';
    } catch {}
  }

  function syncProfitDirection() {
    const el = $('walletProfit');
    if (!el) return;
    const text = String(el.textContent || '').trim();
    el.classList.remove('profitUp','profitDown','profitFlat');
    if (text.startsWith('-')) el.classList.add('profitDown');
    else if (/\+\$0(?:\.0+)?$/.test(text) || /^\$?0(?:\.0+)?$/.test(text)) el.classList.add('profitFlat');
    else el.classList.add('profitUp');
  }

  function removeGrowth() { document.getElementById('walletGrowth')?.remove(); }

  document.addEventListener('DOMContentLoaded', () => {
    removeGrowth();
    syncProfitDirection();
    const profit = $('walletProfit');
    if (profit) new MutationObserver(() => { syncProfitDirection(); removeGrowth(); }).observe(profit,{childList:true,characterData:true,subtree:true});
    const wallet = document.querySelector('.walletProfitRow');
    if (wallet) new MutationObserver(removeGrowth).observe(wallet,{childList:true});
    refreshTradeState();
    setInterval(refreshTradeState,5000);
    setInterval(removeGrowth,1000);
  });
})();
