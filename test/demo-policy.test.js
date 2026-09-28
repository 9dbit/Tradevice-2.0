import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDemoCandidate, cancellationReason, encodeDemoCommand } from '../src/demo-policy.js';

const now = Date.parse('2026-09-28T13:11:00Z');
const iso = ms => new Date(ms).toISOString();
const snapshot = () => ({ symbol: 'XAUUSD', timeframe: 'M1', timestamp: iso(now - 20000), bid: 4155, ask: 4155.24, spread_points: 240,
  features: { terminal_connected: true, broker_symbol: 'XAUUSDm' } });
const candidate = () => ({ trade_id: 'ai-demo-test', decision: 'PLACE_PENDING', side: 'SELL', order_type: 'SELL_LIMIT', regime: 'TREND_DOWN',
  entry: '4164', stop_loss: '4173', take_profit: '4150', confidence: '0.81', expiration_candles: 5,
  created_at: iso(now - 10000), review_status: 'APPROVED', context: { market_timestamp: iso(now - 20000), risk_review: { approved: true },
    pending_trigger: 'PRICE_TOUCH', scenario_guard: { operator: 'ABOVE', price: 4172 } } });
const check = (d = candidate(), s = snapshot()) => evaluateDemoCandidate(d, s, now);

test('81% ready SELL_LIMIT passes; PostgreSQL numeric strings normalize', () => {
  const r = check(); assert.equal(r.approved, true); assert.equal(r.plan.entry, 4164); assert.equal(r.plan.lot, 0.01);
});
test('strict confidence boundary excludes 80%, missing values, NaN and >100%', () => {
  for (const confidence of [0.8, 0.79, null, undefined, '', 'NaN', 1.01]) assert.equal(check({ ...candidate(), confidence }).approved, false, String(confidence));
  assert.equal(check({ ...candidate(), confidence: 0.80001 }).approved, true);
});
test('WAIT at 100% never becomes a pending order', () => {
  assert.equal(check({ ...candidate(), decision: 'WAIT', confidence: 1 }).reason, 'NOT_PLACE_PENDING');
});
test('post-touch confirmation and legacy decisions fail closed', () => {
  for (const trigger of [undefined, null, 'WAIT_FOR_CONFIRMATION']) {
    const d = candidate(); d.context.pending_trigger = trigger; assert.equal(check(d).reason, 'CONFIRMATION_NOT_COMPLETE');
  }
});
test('freshness includes source market time, creation time and feed; rejects future dates', () => {
  for (const offset of [-91000, 6000]) {
    assert.equal(check(candidate(), { ...snapshot(), timestamp: iso(now + offset) }).approved, false);
    assert.equal(check({ ...candidate(), created_at: iso(now + offset) }).approved, false);
    const d = candidate(); d.context.market_timestamp = iso(now + offset); assert.equal(check(d).approved, false);
  }
});
test('missing quotes, disconnected terminal, missing spread and wide spread reject', () => {
  for (const change of [{ bid: null }, { ask: 0 }, { spread_points: null }, { spread_points: 301 }, { ask: 4154 }, { features: {} }])
    assert.equal(check(candidate(), { ...snapshot(), ...change }).approved, false);
});
test('risk approval, review approval, geometry and minimum RR are mandatory', () => {
  for (const change of [{ review_status: 'REJECTED' }, { stop_loss: 4152 }, { take_profit: 4161 }, { order_type: 'BUY_LIMIT' }, { regime: 'CHAOTIC' }])
    assert.equal(check({ ...candidate(), ...change }).approved, false);
  const d = candidate(); d.context.risk_review.approved = false; assert.equal(check(d).approved, false);
});
test('passed entry, short expiry, shadow fill and resolved outcome cannot dispatch', () => {
  assert.equal(check(candidate(), { ...snapshot(), bid: 4165, ask: 4165.24 }).reason, 'PRICE_ALREADY_PASSED');
  assert.equal(check({ ...candidate(), expiration_candles: 0 }).approved, false);
  const d = candidate(); d.context.shadow_state = { status: 'FILLED' }; assert.equal(check(d).approved, false);
  assert.equal(check({ ...candidate(), outcome: { status: 'TP' } }).approved, false);
});
test('structured invalidation is required and must lie on risk side of entry', () => {
  for (const guard of [null, {}, { operator: 'BELOW', price: 4150 }, { operator: 'ABOVE', price: 4180 }]) {
    const d = candidate(); d.context.scenario_guard = guard; assert.equal(check(d).approved, false);
  }
});
test('BUY_STOP has correct quote side and below-entry invalidation', () => {
  const d = candidate(); Object.assign(d, { side: 'BUY', order_type: 'BUY_STOP', entry: 4160, stop_loss: 4154, take_profit: 4172 });
  d.context.scenario_guard = { operator: 'BELOW', price: 4154.5 };
  assert.equal(check(d).approved, true);
});
test('scenario guard and expiry cancel only the existing plan', () => {
  const plan = check().plan;
  assert.equal(cancellationReason(plan, snapshot(), [], now), null);
  assert.equal(cancellationReason(plan, { ...snapshot(), bid: 4172, ask: 4172.24 }, [], now), 'SCENARIO_INVALIDATED');
  assert.equal(cancellationReason(plan, snapshot(), [], now + 300000), 'EXPIRED');
});
test('targeted fresh AI CANCEL works; WAIT, unrelated and stale cancellations do not', () => {
  const plan = check().plan;
  const cancel = { decision: 'CANCEL', created_at: iso(now), context: { cancel_trade_id: plan.trade_id } };
  assert.equal(cancellationReason(plan, snapshot(), [cancel], now), 'AI_CANCELLED_SCENARIO');
  for (const d of [{ ...cancel, decision: 'WAIT', confidence: 1 }, { ...cancel, context: { cancel_trade_id: 'different' } }, { ...cancel, created_at: iso(now - 100000) }])
    assert.equal(cancellationReason(plan, snapshot(), [d], now), null);
});
test('stale feed cancels rather than silently maintaining an unmonitored pending', () => {
  assert.equal(cancellationReason(check().plan, { ...snapshot(), timestamp: iso(now - 91000) }, [], now), 'STALE_FEED');
});
test('wire response has fixed fields, nonce, immutable token and rejects delimiters', () => {
  const p = check().plan, parts = encodeDemoCommand('PLACE', '123', { plan: p }, now).split('|');
  assert.equal(parts.length, 15); assert.equal(parts[14], '123'); assert.equal(parts[2].length, 24);
  assert.equal(check().plan.token, p.token);
  assert.throws(() => encodeDemoCommand('PLACE', '123', { plan: { ...p, symbol: 'XAUUSDm|evil' } }, now));
});
