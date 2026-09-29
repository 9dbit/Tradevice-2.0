import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSbrRbsSetup } from '../src/structure-engine.js';

function bar(i, open, high, low, close) {
  return {
    timestamp: new Date(Date.UTC(2026, 8, 29, 0, i * 5)).toISOString(),
    open, high, low, close, tick_volume: 100 + i
  };
}

function bearishContext() {
  const m5 = [];
  for (let i = 0; i < 24; i++) {
    const base = 101.2 - i * 0.015;
    m5.push(bar(i, base, base + 0.35, base - 0.30, base - 0.05));
  }
  m5[3] = bar(3, 99.0, 99.4, 97.8, 98.9);
  m5[8] = bar(8, 100.7, 101.0, 100.20, 100.65);
  m5[9] = bar(9, 100.7, 101.0, 100.55, 100.8);
  m5[14] = bar(14, 100.65, 100.9, 100.18, 100.62);
  m5[15] = bar(15, 100.7, 100.95, 100.55, 100.75);
  m5[21] = bar(21, 100.7, 100.9, 100.22, 100.60);
  m5[22] = bar(22, 100.55, 100.75, 100.25, 100.38);
  m5[23] = bar(23, 100.35, 100.42, 99.25, 99.35);
  const m15 = [];
  for (let i = 0; i < 16; i++) m15.push(bar(i, 104 - i * 0.25, 104.2 - i * 0.25, 103.4 - i * 0.25, 103.7 - i * 0.25));
  return { m5, m15 };
}

function snapshot(m5, m15, bid, ask) {
  return {
    symbol: 'XAUUSD', timeframe: 'M1', timestamp: m5[m5.length - 1].timestamp,
    bid, ask, spread_points: 240,
    features: { m5_candles: m5, m15_candles: m15, point_size: 0.001, digits: 3 }
  };
}

test('confirmed support break arms SBR sell limit without AI', () => {
  const { m5, m15 } = bearishContext();
  const result = detectSbrRbsSetup(snapshot(m5, m15, 99.35, 99.59));
  assert.equal(result.state, 'SBR_ARMED');
  assert.equal(result.candidate.setup, 'SBR_RETEST');
  assert.equal(result.candidate.side, 'SELL');
  assert.equal(result.candidate.order_type, 'SELL_LIMIT');
  assert.ok(result.candidate.setup_score >= 70);
  assert.ok(result.candidate.rr >= 1.5);
});

test('same support without confirmed break creates no event', () => {
  const { m5, m15 } = bearishContext();
  m5[m5.length - 1] = bar(23, 100.42, 100.68, 100.25, 100.48);
  const result = detectSbrRbsSetup(snapshot(m5, m15, 100.48, 100.72));
  assert.equal(result.state, 'NO_EVENT');
  assert.equal(result.candidate, null);
});

test('engine returns a stable fingerprint for the same structural event', () => {
  const { m5, m15 } = bearishContext();
  const a = detectSbrRbsSetup(snapshot(m5, m15, 99.35, 99.59));
  const b = detectSbrRbsSetup(snapshot(m5, m15, 99.34, 99.58));
  assert.equal(a.candidate.fingerprint, b.candidate.fingerprint);
});
