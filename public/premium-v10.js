(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v,d=3) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
  const fmtMoney = v => typeof v === 'number' && Number.isFinite(v) ? `${v>=0?'+':'-'}$${Math.abs(v).toFixed(2)}` : '$—';
  const shortTimeMs = v => { const d=new Date(Number(v)); return Number.isFinite(Number(v)) && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—'; };
  const metric = (label,value,cls='') => `<div class="miniMetric"><span class="mk">${esc(label)}</span><strong class="mv ${cls}">${esc(value)}</strong></div>`;

  function periodLabel(period){ return period==='W'?'Weekly':period==='M'?'Monthly':'Daily'; }
  function activePeriod(){ return document.querySelector('[data-profit-period].active')?.dataset.profitPeriod || 'D'; }

  function positionCard(p){
    const pnl = Number(p.net_profit);
    const positive = !Number.isFinite(pnl) || pnl >= 0;
    const pnlClass = positive ? 'profit' : 'loss';
    const sideClass = p.side === 'BUY' ? 'buy' : 'sell';
    return `<article class="tradeStateItem brokerCard ${positive?'isProfit':'isLoss'}"><div class="tradeMiniGrid">
      <div class="miniMetric positionProfit"><span class="mk">Open P/L</span><strong class="mv ${pnlClass}">${fmtMoney(pnl)}</strong><span class="subPnl">MT5 broker position</span></div>
      ${metric('Status','OPEN','profit')}${metric('Side',p.side||'—',sideClass)}
      ${metric('Entry',num(p.price_open))}${metric('Mark',num(p.price_current))}${metric('TP',num(p.take_profit),'profit')}${metric('SL',num(p.stop_loss),'loss')}
      ${metric('Volume',Number.isFinite(Number(p.volume))?Number(p.volume).toFixed(2):'—')}${metric('Swap',fmtMoney(Number(p.swap)))}${metric('Ticket',p.ticket||'—')}${metric('Source','MT5','profit')}
    </div></article>`;
  }

  function orderCard(o){
    const type = String(o.type||'—').replaceAll('_',' ');
    const side = type.startsWith('BUY') ? 'BUY' : type.startsWith('SELL') ? 'SELL' : '—';
    const sideClass = side === 'BUY' ? 'buy' : side === 'SELL' ? 'sell' : '';
    return `<article class="tradeStateItem brokerCard"><div class="tradeMiniGrid">
      ${metric('Symbol',o.symbol||'XAUUSD')}${metric('Side',side,sideClass)}${metric('Order',type)}${metric('Status',String(o.state||'PLACED').replaceAll('_',' '),'profit')}
      ${metric('Entry',num(o.price_open))}${metric('Current',num(o.price_current))}${metric('TP',num(o.take_profit),'profit')}${metric('SL',num(o.stop_loss),'loss')}
      ${metric('Volume',Number.isFinite(Number(o.volume_current))?Number(o.volume_current).toFixed(2):'—')}${metric('Ticket',o.ticket||'—')}${metric('Position',o.position_id||'—')}${metric('Source','MT5','profit')}
    </div></article>`;
  }

  function setWallet(state){
    const a = state.account || {};
    const moneyPlain = v => typeof v==='number' && Number.isFinite(v) ? `$${v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : '$—';
    if ($('walletEquity')) $('walletEquity').textContent = moneyPlain(a.equity);
    if ($('walletBalance')) $('walletBalance').textContent = moneyPlain(a.balance);
    if ($('walletFreeMargin')) $('walletFreeMargin').textContent = moneyPlain(a.free_margin);
    if ($('walletPositions')) $('walletPositions').textContent = String(state.positions?.length ?? a.positions_total ?? 0);
    if ($('walletOrders')) $('walletOrders').textContent = String(state.orders?.length ?? a.orders_total ?? 0);
    if ($('walletFloating')) {
      const fp = Number(a.floating_profit);
      $('walletFloating').textContent = Number.isFinite(fp) ? `Floating ${fmtMoney(fp)}` : 'Floating $—';
      $('walletFloating').classList.toggle('green',fp>0);
      $('walletFloating').classList.toggle('red',fp<0);
    }
    const mode = document.querySelector('.walletMode');
    if (mode) mode.textContent = Number(state.age_seconds) > 12 ? 'MT5 STALE' : 'MT5 SYNC';
  }

  async function refreshBrokerProfit(){
    try {
      const period = activePeriod();
      const res = await fetch(`/api/v1/broker/performance?period=${encodeURIComponent(period)}`, {cache:'no-store'});
      if (!res.ok) return;
      const p = await res.json();
      if ($('walletProfitLabel')) $('walletProfitLabel').textContent = `${periodLabel(period)} Broker P/L`;
      if ($('walletProfit')) $('walletProfit').textContent = fmtMoney(Number(p.realized_net));
      if ($('walletProfitDetail')) $('walletProfitDetail').textContent = `${p.closed_deals||0} closed · ${p.wins||0}W/${p.losses||0}L · fees ${fmtMoney(Number(p.commission||0)+Number(p.swap||0)+Number(p.fee||0))}`;
    } catch {}
  }

  async function refreshBroker(){
    try {
      const res = await fetch('/api/v1/broker/state', {cache:'no-store'});
      if (!res.ok) { window.TRADEVICE_BROKER_SYNC_V2 = false; return; }
      const state = await res.json();
      window.TRADEVICE_BROKER_SYNC_V2 = true;
      setWallet(state);
      const positions = Array.isArray(state.positions) ? state.positions : [];
      const orders = Array.isArray(state.orders) ? state.orders : [];
      if ($('openPositionsCount')) $('openPositionsCount').textContent = `${positions.length} MT5`;
      if ($('pendingOrdersCount')) $('pendingOrdersCount').textContent = `${orders.length} MT5`;
      if ($('openPositionsWrap')) $('openPositionsWrap').innerHTML = positions.length ? positions.map(positionCard).join('') : '<div class="tradeEmpty">No MT5 open positions.</div>';
      if ($('pendingOrdersWrap')) $('pendingOrdersWrap').innerHTML = orders.length ? orders.map(orderCard).join('') : '<div class="tradeEmpty">No MT5 pending orders.</div>';
      const posSub = document.querySelector('.positionSection .sectionHead div span');
      const ordSub = document.querySelector('.orderSection .sectionHead div span');
      if (posSub) posSub.textContent = `MT5 broker positions · ${Number(state.age_seconds)||0}s sync age`;
      if (ordSub) ordSub.textContent = `MT5 broker pending orders · ${Number(state.age_seconds)||0}s sync age`;
      await refreshBrokerProfit();
    } catch { window.TRADEVICE_BROKER_SYNC_V2 = false; }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-profit-period]')) setTimeout(refreshBrokerProfit, 20);
  });

  document.addEventListener('DOMContentLoaded', () => {
    refreshBroker();
    setInterval(refreshBroker, 3000);
  });
})();
