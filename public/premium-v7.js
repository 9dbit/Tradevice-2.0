(() => {
  const $ = id => document.getElementById(id);
  let profitPeriod = 'D';
  const exnessUrl = 'https://my.exness.com/accounts/sign-in/?lng=id';

  function haptic(pattern = 4) {
    try { if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern); } catch {}
  }

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

  async function refreshProfit() {
    if (window.TRADEVICE_BROKER_SYNC_V2 === true) return;
    try {
      const [ledgerRes, dashboardRes] = await Promise.all([
        fetch('/api/v1/orders/ledger?limit=500', { cache: 'no-store' }),
        fetch('/api/v1/dashboard', { cache: 'no-store' })
      ]);
      if (!ledgerRes.ok || !dashboardRes.ok) return;
      const ledger = await ledgerRes.json();
      const dashboard = await dashboardRes.json();
      const start = periodStart(profitPeriod).getTime();
      const closed = (ledger.orders || []).filter(order => {
        if (!['PROFIT','LOSS','CLOSED'].includes(order.lifecycle)) return false;
        const t = new Date(order.closed_at || order.created_at || 0).getTime();
        return Number.isFinite(t) && t >= start;
      });
      const profit = closed.reduce((sum, order) => sum + tradeUsd(order), 0);
      const wins = closed.filter(order => tradeUsd(order) > 0).length;
      const losses = closed.filter(order => tradeUsd(order) < 0).length;
      const balance = Number(dashboard?.account?.balance);
      const pct = Number.isFinite(balance) && balance !== 0 ? profit / balance * 100 : null;
      const label = profitPeriod === 'D' ? 'Daily' : profitPeriod === 'W' ? 'Weekly' : 'Monthly';
      const value = $('walletProfit');
      const detail = $('walletProfitDetail');
      const caption = $('walletProfitLabel');
      if (caption) caption.textContent = `${label} Tradevice P/L`;
      if (value) {
        value.textContent = `${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(2)}`;
        value.style.color = profit < 0 ? '#7b0817' : '#021008';
      }
      if (detail) detail.textContent = `${closed.length} closed · ${wins}W/${losses}L${pct === null ? '' : ` · ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% of balance`}`;
    } catch {}
  }

  function setPeriod(period) {
    profitPeriod = ['D','W','M'].includes(period) ? period : 'D';
    document.querySelectorAll('[data-profit-period]').forEach(button => button.classList.toggle('active', button.dataset.profitPeriod === profitPeriod));
    refreshProfit();
  }

  document.addEventListener('pointerdown', event => {
    const period = event.target.closest('[data-profit-period]');
    if (period) {
      haptic(4);
      setPeriod(period.dataset.profitPeriod);
      return;
    }
    const action = event.target.closest('.walletAction');
    if (action) {
      haptic(5);
      action.classList.add('pointerPressed');
    }
  }, { passive: true });

  const clearPress = () => document.querySelectorAll('.walletAction.pointerPressed').forEach(el => el.classList.remove('pointerPressed'));
  document.addEventListener('pointerup', clearPress, { passive: true });
  document.addEventListener('pointercancel', clearPress, { passive: true });

  document.addEventListener('click', event => {
    const action = event.target.closest('.walletAction');
    if (!action) return;
    event.preventDefault();
    window.open(exnessUrl, '_blank', 'noopener,noreferrer');
  });

  setPeriod('D');
  refreshProfit();
  setInterval(refreshProfit, 15000);
})();
