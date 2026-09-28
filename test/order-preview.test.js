import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderPreview } from '../src/order-preview.js';

const baseDecision = {
  trade_id: 't1', decision: 'PLACE_PENDING', review_status: 'APPROVED', outcome: null,
  side: 'SELL', order_type: 'SELL_LIMIT', entry: 4122.2, stop_loss: 4124.15, take_profit: 4117.65,
  expiration_candles: 5, created_at: '2026-09-28T20:15:00Z', context: { market_timestamp: '2026-09-28T20:15:00Z' }
};

const broker = {
  timestamp: '2026-09-28T20:16:00Z', received_at: '2026-09-28T20:16:00Z', broker_symbol: 'XAUUSDm',
  account: { trade_mode: 0 }
};

test('approved fresh pending plan becomes manual-execution ready', () => {
  const p = buildOrderPreview([baseDecision], { bid: 4121.3, ask: 4121.5 }, broker, Date.parse('2026-09-28T20:16:05Z'));
  assert.equal(p.status, 'READY_FOR_MANUAL_EXECUTION');
  assert.deepEqual(p.reasons, []);
  assert.equal(p.broker_symbol, 'XAUUSDm');
});

test('stale plan is blocked', () => {
  const p = buildOrderPreview([baseDecision], { bid: 4121.3, ask: 4121.5 }, broker, Date.parse('2026-09-28T20:22:00Z'));
  assert.equal(p.status, 'BLOCKED');
  assert.ok(p.reasons.includes('PLAN_STALE'));
});

test('crossed pending price is blocked', () => {
  const p = buildOrderPreview([baseDecision], { bid: 4122.4, ask: 4122.6 }, broker, Date.parse('2026-09-28T20:16:05Z'));
  assert.equal(p.status, 'BLOCKED');
  assert.ok(p.reasons.includes('PENDING_PRICE_ALREADY_CROSSED'));
});

test('non-demo broker state is blocked', () => {
  const liveBroker = { ...broker, account: { trade_mode: 2 } };
  const p = buildOrderPreview([baseDecision], { bid: 4121.3, ask: 4121.5 }, liveBroker, Date.parse('2026-09-28T20:16:05Z'));
  assert.equal(p.status, 'BLOCKED');
  assert.ok(p.reasons.includes('ACCOUNT_NOT_DEMO'));
});
