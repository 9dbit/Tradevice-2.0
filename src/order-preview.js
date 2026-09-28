const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function ageSeconds(value, nowMs) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? Math.max(0, (nowMs - ms) / 1000) : Infinity;
}

export function buildOrderPreview(decisions = [], snapshot = null, brokerState = null, nowMs = Date.now()) {
  const row = decisions.find(d => d.decision === 'PLACE_PENDING' && d.review_status === 'APPROVED' && !d.outcome);
  if (!row) return { status: 'EMPTY', reason: 'NO_APPROVED_PENDING_PLAN' };

  const marketTimestamp = row.context?.market_timestamp || row.created_at;
  const expirySeconds = Math.max(1, Number(row.expiration_candles || 3)) * 60 + 30;
  const age = ageSeconds(marketTimestamp, nowMs);
  const reasons = [];

  const entry = num(row.entry), sl = num(row.stop_loss), tp = num(row.take_profit);
  const bid = num(snapshot?.bid), ask = num(snapshot?.ask);
  if ([entry, sl, tp].some(v => v === null)) reasons.push('INVALID_PRICE_FIELDS');
  if (age > expirySeconds) reasons.push('PLAN_STALE');

  if (entry !== null && bid !== null && ask !== null) {
    if (row.order_type === 'BUY_LIMIT' && entry >= ask) reasons.push('PENDING_PRICE_ALREADY_CROSSED');
    if (row.order_type === 'SELL_LIMIT' && entry <= bid) reasons.push('PENDING_PRICE_ALREADY_CROSSED');
    if (row.order_type === 'BUY_STOP' && entry <= ask) reasons.push('PENDING_PRICE_ALREADY_CROSSED');
    if (row.order_type === 'SELL_STOP' && entry >= bid) reasons.push('PENDING_PRICE_ALREADY_CROSSED');
  }

  const brokerAge = ageSeconds(brokerState?.received_at || brokerState?.timestamp, nowMs);
  if (!brokerState) reasons.push('BROKER_STATE_MISSING');
  else if (brokerAge > 10) reasons.push('BROKER_STATE_STALE');
  else if (Number(brokerState?.account?.trade_mode) !== 0) reasons.push('ACCOUNT_NOT_DEMO');

  const brokerSymbol = String(brokerState?.broker_symbol || 'XAUUSD');
  return {
    status: reasons.length ? 'BLOCKED' : 'READY_FOR_MANUAL_EXECUTION',
    reasons,
    trade_id: row.trade_id,
    symbol: row.side ? 'XAUUSD' : null,
    broker_symbol: brokerSymbol,
    side: row.side,
    order_type: row.order_type,
    entry,
    stop_loss: sl,
    take_profit: tp,
    lot: 0.01,
    market_timestamp: marketTimestamp,
    age_seconds: Math.floor(age),
    expires_after_seconds: expirySeconds,
    current_bid: bid,
    current_ask: ask,
    note: 'Preview only. Tradevice does not send this order to the broker.'
  };
}
