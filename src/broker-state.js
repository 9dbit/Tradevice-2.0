function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

export function mergeBrokerState(previous, incoming) {
  const prior = previous && typeof previous === 'object' ? previous : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  return {
    ...prior,
    ...next,
    account: { ...(prior.account ?? {}), ...(next.account ?? {}) },
    positions: arr(next.positions),
    orders: arr(next.orders),
    history_deals: Array.isArray(next.history_deals) ? next.history_deals : arr(prior.history_deals),
    received_at: new Date().toISOString()
  };
}

function publicPosition(row) {
  const profit = n(row?.profit) ?? 0;
  const swap = n(row?.swap) ?? 0;
  return {
    ticket: String(row?.ticket ?? ''), identifier: String(row?.identifier ?? ''),
    symbol: row?.symbol ?? null, side: row?.side ?? null, volume: n(row?.volume),
    price_open: n(row?.price_open), price_current: n(row?.price_current),
    stop_loss: n(row?.stop_loss), take_profit: n(row?.take_profit),
    profit, swap, net_profit: profit + swap,
    time_msc: n(row?.time_msc), magic: n(row?.magic)
  };
}

function publicOrder(row) {
  return {
    ticket: String(row?.ticket ?? ''), position_id: String(row?.position_id ?? ''),
    symbol: row?.symbol ?? null, type: row?.type ?? null, state: row?.state ?? null,
    volume_initial: n(row?.volume_initial), volume_current: n(row?.volume_current),
    price_open: n(row?.price_open), price_current: n(row?.price_current),
    stop_loss: n(row?.stop_loss), take_profit: n(row?.take_profit),
    time_setup_msc: n(row?.time_setup_msc), expiration: n(row?.expiration), magic: n(row?.magic)
  };
}

function publicDeal(row) {
  const profit = n(row?.profit) ?? 0;
  const commission = n(row?.commission) ?? 0;
  const swap = n(row?.swap) ?? 0;
  const fee = n(row?.fee) ?? 0;
  return {
    ticket: String(row?.ticket ?? ''), order_id: String(row?.order_id ?? ''), position_id: String(row?.position_id ?? ''),
    symbol: row?.symbol ?? null, type: row?.type ?? null, entry: row?.entry ?? null,
    volume: n(row?.volume), price: n(row?.price), profit, commission, swap, fee,
    net: profit + commission + swap + fee, time_msc: n(row?.time_msc), magic: n(row?.magic)
  };
}

export function brokerStateView(state) {
  if (!state || typeof state !== 'object') return null;
  const account = state.account ?? {};
  const received = Date.parse(state.received_at ?? state.timestamp ?? '');
  const ageSeconds = Number.isFinite(received) ? Math.max(0, Math.floor((Date.now() - received) / 1000)) : null;
  return {
    generated_at: new Date().toISOString(), source: 'MT5', timestamp: state.timestamp ?? null,
    received_at: state.received_at ?? null, age_seconds: ageSeconds,
    bridge_version: state.bridge_version ?? state.features?.bridge_version ?? null,
    broker_symbol: state.broker_symbol ?? state.features?.broker_symbol ?? null,
    account: {
      balance: n(account.balance), equity: n(account.equity), margin: n(account.margin), free_margin: n(account.margin_free),
      margin_level: n(account.margin_level), floating_profit: n(account.profit), credit: n(account.credit),
      currency: account.currency ?? null, leverage: n(account.leverage), trade_mode: account.trade_mode ?? null,
      positions_total: Number(account.positions_total ?? arr(state.positions).length), orders_total: Number(account.orders_total ?? arr(state.orders).length)
    },
    positions: arr(state.positions).map(publicPosition),
    orders: arr(state.orders).map(publicOrder),
    history_deals: arr(state.history_deals).map(publicDeal)
  };
}

function zonedParts(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), date: d.getUTCDate(), day: d.getUTCDay() };
}

function periodStartMs(period, offsetMinutes = 420) {
  const now = Date.now();
  const p = zonedParts(now, offsetMinutes);
  let date = p.date;
  let month = p.m;
  if (period === 'W') date -= ((p.day || 7) - 1);
  if (period === 'M') date = 1;
  return Date.UTC(p.y, month, date, 0, 0, 0, 0) - offsetMinutes * 60000;
}

export function brokerPerformance(state, period = 'D', offsetMinutes = 420) {
  const normalized = ['D','W','M'].includes(String(period).toUpperCase()) ? String(period).toUpperCase() : 'D';
  const startMs = periodStartMs(normalized, Number.isFinite(Number(offsetMinutes)) ? Number(offsetMinutes) : 420);
  const deals = arr(state?.history_deals).map(publicDeal).filter(d => Number.isFinite(d.time_msc) && d.time_msc >= startMs);
  const trading = deals.filter(d => ['BUY','SELL'].includes(String(d.type ?? '').toUpperCase()));
  const realized = trading.reduce((sum, d) => sum + d.net, 0);
  const grossProfit = trading.reduce((sum, d) => sum + d.profit, 0);
  const commission = trading.reduce((sum, d) => sum + d.commission, 0);
  const swap = trading.reduce((sum, d) => sum + d.swap, 0);
  const fee = trading.reduce((sum, d) => sum + d.fee, 0);
  const closingDeals = trading.filter(d => ['OUT','OUT_BY'].includes(String(d.entry ?? '').toUpperCase()));
  const wins = closingDeals.filter(d => d.profit > 0).length;
  const losses = closingDeals.filter(d => d.profit < 0).length;
  return {
    generated_at: new Date().toISOString(), source: 'MT5', period: normalized, timezone_offset_minutes: Number(offsetMinutes),
    start_at: new Date(startMs).toISOString(), realized_net: realized, gross_profit: grossProfit,
    commission, swap, fee, closed_deals: closingDeals.length, wins, losses,
    deal_count: trading.length
  };
}
