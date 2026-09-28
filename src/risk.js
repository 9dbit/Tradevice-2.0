const MAX_SPREAD_POINTS = Number(process.env.MAX_SPREAD_POINTS || 300);
const MIN_REWARD_RISK = Number(process.env.MIN_REWARD_RISK || 1.15);

export function validateTradeIntent(intent, snapshot) {
  const reasons = [];
  if (intent.decision !== 'PLACE_PENDING') {
    return { approved: true, reasons, metrics: null };
  }

  const required = ['side', 'order_type', 'entry', 'stop_loss', 'take_profit'];
  for (const key of required) {
    if (intent[key] === undefined || intent[key] === null) reasons.push(`MISSING_${key.toUpperCase()}`);
  }
  if (reasons.length) return { approved: false, reasons, metrics: null };

  const entry = Number(intent.entry);
  const sl = Number(intent.stop_loss);
  const tp = Number(intent.take_profit);
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rr = risk > 0 ? reward / risk : 0;

  if (intent.side === 'BUY' && !(sl < entry && entry < tp)) reasons.push('INVALID_BUY_PRICE_STRUCTURE');
  if (intent.side === 'SELL' && !(tp < entry && entry < sl)) reasons.push('INVALID_SELL_PRICE_STRUCTURE');
  if (!Number.isFinite(rr) || rr < MIN_REWARD_RISK) reasons.push('REWARD_RISK_TOO_LOW');

  const spread = Number(snapshot?.spread_points);
  if (Number.isFinite(spread) && spread > MAX_SPREAD_POINTS) reasons.push('SPREAD_TOO_WIDE');

  const bid = Number(snapshot?.bid);
  const ask = Number(snapshot?.ask);
  if (Number.isFinite(bid) && Number.isFinite(ask)) {
    if (intent.order_type === 'BUY_LIMIT' && !(entry < ask)) reasons.push('BUY_LIMIT_NOT_BELOW_ASK');
    if (intent.order_type === 'SELL_LIMIT' && !(entry > bid)) reasons.push('SELL_LIMIT_NOT_ABOVE_BID');
    if (intent.order_type === 'BUY_STOP' && !(entry > ask)) reasons.push('BUY_STOP_NOT_ABOVE_ASK');
    if (intent.order_type === 'SELL_STOP' && !(entry < bid)) reasons.push('SELL_STOP_NOT_BELOW_BID');
  }

  return {
    approved: reasons.length === 0,
    reasons,
    metrics: {
      risk_distance: risk,
      reward_distance: reward,
      reward_risk: rr,
      spread_points: Number.isFinite(spread) ? spread : null,
      max_spread_points: MAX_SPREAD_POINTS,
      min_reward_risk: MIN_REWARD_RISK
    }
  };
}
