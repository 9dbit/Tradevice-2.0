import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTradeIntent } from '../src/risk.js';

const snapshot = {
  bid: 4320.000,
  ask: 4320.100,
  spread_points: 100
};

test('approves a structurally valid BUY_LIMIT shadow intent', () => {
  const result = validateTradeIntent({
    decision: 'PLACE_PENDING',
    side: 'BUY',
    order_type: 'BUY_LIMIT',
    entry: 4319.500,
    stop_loss: 4318.500,
    take_profit: 4321.000
  }, snapshot);

  assert.equal(result.approved, true);
  assert.equal(result.reasons.length, 0);
  assert.ok(result.metrics.reward_risk >= 1.15);
});

test('rejects invalid BUY price structure', () => {
  const result = validateTradeIntent({
    decision: 'PLACE_PENDING',
    side: 'BUY',
    order_type: 'BUY_LIMIT',
    entry: 4319.500,
    stop_loss: 4320.000,
    take_profit: 4321.000
  }, snapshot);

  assert.equal(result.approved, false);
  assert.ok(result.reasons.includes('INVALID_BUY_PRICE_STRUCTURE'));
});

test('rejects poor reward/risk', () => {
  const result = validateTradeIntent({
    decision: 'PLACE_PENDING',
    side: 'SELL',
    order_type: 'SELL_LIMIT',
    entry: 4321.000,
    stop_loss: 4322.000,
    take_profit: 4320.200
  }, snapshot);

  assert.equal(result.approved, false);
  assert.ok(result.reasons.includes('REWARD_RISK_TOO_LOW'));
});

test('rejects wide spread', () => {
  const result = validateTradeIntent({
    decision: 'PLACE_PENDING',
    side: 'BUY',
    order_type: 'BUY_LIMIT',
    entry: 4319.500,
    stop_loss: 4318.500,
    take_profit: 4321.000
  }, { ...snapshot, spread_points: 301 });

  assert.equal(result.approved, false);
  assert.ok(result.reasons.includes('SPREAD_TOO_WIDE'));
});

test('WAIT passes without order fields', () => {
  const result = validateTradeIntent({ decision: 'WAIT' }, snapshot);
  assert.equal(result.approved, true);
});
