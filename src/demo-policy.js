import crypto from 'node:crypto';

const positive = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) && Number(x) > 0;
const age = (x, now) => now - Date.parse(x);
export const DEMO_CONFIDENCE = 0.80; // Strictly greater, never >=.
export const DEMO_LOT = 0.01;
export const DEMO_MAX_SPREAD = 300;
export const DEMO_MIN_RR = 1.5;

export function feedIssue(snapshot, now = Date.now()) {
  const ms = age(snapshot?.timestamp, now);
  if (!Number.isFinite(ms) || ms < -5000 || ms > 90000) return 'STALE_FEED';
  if (snapshot?.features?.terminal_connected !== true) return 'OBSERVER_DISCONNECTED';
  if (snapshot?.symbol !== 'XAUUSD' || snapshot?.timeframe !== 'M1') return 'WRONG_FEED';
  if (!positive(snapshot.bid) || !positive(snapshot.ask) || snapshot.ask < snapshot.bid) return 'INVALID_QUOTE';
  if (snapshot.spread_points == null || !Number.isFinite(Number(snapshot.spread_points)) || snapshot.spread_points < 0 || snapshot.spread_points > DEMO_MAX_SPREAD) return 'SPREAD_TOO_WIDE_OR_MISSING';
  return null;
}

export function evaluateDemoCandidate(decision, snapshot, now = Date.now()) {
  const reject = reason => ({ approved: false, reason });
  const feed = feedIssue(snapshot, now);
  if (feed) return reject(feed);
  if (decision?.decision !== 'PLACE_PENDING') return reject('NOT_PLACE_PENDING');
  if (!(Number(decision.confidence) > DEMO_CONFIDENCE && Number(decision.confidence) <= 1)) return reject('CONFIDENCE_NOT_ABOVE_80');
  if (decision.review_status !== 'APPROVED' || decision.context?.risk_review?.approved !== true) return reject('REVIEW_NOT_APPROVED');
  if (['CHAOTIC', 'NO_TRADE'].includes(decision.regime)) return reject('REGIME_BLOCKED');
  if (decision.context?.pending_trigger !== 'PRICE_TOUCH') return reject('CONFIRMATION_NOT_COMPLETE');
  const createdAge = age(decision.created_at, now);
  const marketAge = age(decision.context?.market_timestamp, now);
  if (![createdAge, marketAge].every(x => Number.isFinite(x) && x >= -5000 && x <= 90000)) return reject('STALE_ANALYSIS');
  if (decision.outcome || decision.context?.shadow_state?.status === 'FILLED') return reject('SETUP_ALREADY_RESOLVED');
  const { entry, stop_loss: sl, take_profit: tp, side, order_type: type } = decision;
  if (![entry, sl, tp].every(positive)) return reject('INVALID_PRICES');
  if (!['BUY', 'SELL'].includes(side) || ![`${side}_LIMIT`, `${side}_STOP`].includes(type)) return reject('INVALID_ORDER_TYPE');
  if (side === 'BUY' ? !(Number(sl) < Number(entry) && Number(entry) < Number(tp)) : !(Number(tp) < Number(entry) && Number(entry) < Number(sl))) return reject('INVALID_PRICE_STRUCTURE');
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
  if (!Number.isFinite(rr) || rr < DEMO_MIN_RR) return reject('REWARD_RISK_TOO_LOW');
  if ((type === 'BUY_LIMIT' && !(entry < snapshot.ask)) || (type === 'BUY_STOP' && !(entry > snapshot.ask)) ||
      (type === 'SELL_LIMIT' && !(entry > snapshot.bid)) || (type === 'SELL_STOP' && !(entry < snapshot.bid))) return reject('PRICE_ALREADY_PASSED');
  const candles = Number(decision.expiration_candles);
  if (!Number.isInteger(candles) || candles < 1 || candles > 10) return reject('INVALID_EXPIRY');
  const expires = Date.parse(decision.context.market_timestamp) + candles * 60000;
  if (expires - now < 30000) return reject('EXPIRY_TOO_CLOSE');
  const guard = decision.context?.scenario_guard;
  if (!guard || !['ABOVE', 'BELOW'].includes(guard.operator) || !positive(guard.price)) return reject('MISSING_INVALIDATION');
  if (side === 'SELL' ? !(guard.operator === 'ABOVE' && guard.price > entry && guard.price <= sl) : !(guard.operator === 'BELOW' && guard.price < entry && guard.price >= sl)) return reject('INVALID_INVALIDATION');
  const symbol = snapshot.features.broker_symbol;
  if (typeof symbol !== 'string' || !/^XAUUSD[A-Za-z0-9._-]*$/.test(symbol)) return reject('INVALID_BROKER_SYMBOL');
  const plan = {
    token: crypto.createHash('sha256').update(decision.trade_id).digest('hex').slice(0, 24),
    trade_id: decision.trade_id, symbol, side, order_type: type,
    entry: Number(entry), stop_loss: Number(sl), take_profit: Number(tp), lot: DEMO_LOT,
    confidence: Number(decision.confidence), expires_at: new Date(expires).toISOString(),
    invalidation_operator: guard.operator, invalidation_price: Number(guard.price),
    source_market_timestamp: decision.context.market_timestamp
  };
  const cancelled = cancellationReason(plan, snapshot, [], now);
  return cancelled ? reject(cancelled) : { approved: true, plan };
}

export function cancellationReason(plan, snapshot, decisions = [], now = Date.now()) {
  if (now >= Date.parse(plan.expires_at)) return 'EXPIRED';
  const feed = feedIssue(snapshot, now);
  if (feed) return feed;
  const price = plan.side === 'SELL' ? snapshot.ask : snapshot.bid;
  if ((plan.invalidation_operator === 'ABOVE' && price >= plan.invalidation_price) ||
      (plan.invalidation_operator === 'BELOW' && price <= plan.invalidation_price)) return 'SCENARIO_INVALIDATED';
  // A WAIT, low confidence or unrelated cancellation is not an instruction to delete this order.
  const cancel = decisions.find(d => d.decision === 'CANCEL' && d.context?.cancel_trade_id === plan.trade_id &&
    Date.parse(d.created_at) >= Date.parse(plan.source_market_timestamp) && age(d.created_at, now) >= -5000 && age(d.created_at, now) <= 90000);
  return cancel ? 'AI_CANCELLED_SCENARIO' : null;
}

export function encodeDemoCommand(action, nonce, { plan, reason = 'OK' } = {}, now = Date.now()) {
  const fields = ['TV2', action, plan?.token ?? '-', plan?.symbol ?? '-', plan?.order_type ?? '-',
    plan?.entry ?? 0, plan?.stop_loss ?? 0, plan?.take_profit ?? 0, plan?.lot ?? 0,
    plan ? Math.floor(Date.parse(plan.expires_at) / 1000) : 0,
    plan?.invalidation_operator ?? '-', plan?.invalidation_price ?? 0, reason, Math.floor(now / 1000), nonce];
  if (fields.some(x => /[|\r\n]/.test(String(x)))) throw new Error('Invalid wire field');
  return fields.join('|');
}
