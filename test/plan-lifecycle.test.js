import test from 'node:test';
import assert from 'node:assert/strict';
import { planExpiryInfo } from '../src/plan-service.js';

test('deterministic SBR plans use M5 expiration windows', () => {
  const plan = {
    market_timestamp: '2026-09-29T04:00:00Z',
    expiration_candles: 6,
    source_model: 'deterministic-sbr-rbs-v1'
  };
  const fresh = planExpiryInfo(plan, Date.parse('2026-09-29T04:29:00Z'));
  const expired = planExpiryInfo(plan, Date.parse('2026-09-29T04:31:00Z'));
  assert.equal(fresh.candle_minutes, 5);
  assert.equal(fresh.expired, false);
  assert.equal(expired.expired, true);
});

test('deterministic channel plans honor explicit M15 expiration', () => {
  const plan = {
    market_timestamp: '2026-09-29T04:00:00Z',
    expiration_candles: 8,
    source_model: 'deterministic-channel-trendline-v1',
    review: { expiration_timeframe: 'M15' }
  };
  const fresh = planExpiryInfo(plan, Date.parse('2026-09-29T05:59:00Z'));
  const expired = planExpiryInfo(plan, Date.parse('2026-09-29T06:01:00Z'));
  assert.equal(fresh.candle_minutes, 15);
  assert.equal(fresh.expired, false);
  assert.equal(expired.expired, true);
});

test('legacy AI plans use M1 expiration windows', () => {
  const plan = {
    market_timestamp: '2026-09-29T04:00:00Z',
    expiration_candles: 3,
    source_model: 'gpt-6-astra'
  };
  const expired = planExpiryInfo(plan, Date.parse('2026-09-29T04:04:00Z'));
  assert.equal(expired.candle_minutes, 1);
  assert.equal(expired.expired, true);
});
