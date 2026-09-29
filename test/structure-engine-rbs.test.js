import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSbrRbsSetup } from '../src/structure-engine.js';

function bar(i, open, high, low, close) {
  return { timestamp: new Date(Date.UTC(2026, 8, 29, 0, i * 5)).toISOString(), open, high, low, close, tick_volume: 100 + i };
}

function bearishBars() {
  const bars = [];
  for (let i = 0; i < 24; i++) {
    const base = 101.2 - i * 0.015;
    bars.push(bar(i, base, base + 0.35, base - 0.30, base - 0.05));
  }
  bars[3] = bar(3, 99.0, 99.4, 97.8, 98.9);
  bars[8] = bar(8, 100.7, 101.0, 100.20, 100.65);
  bars[9] = bar(9, 100.7, 101.0, 100.55, 100.8);
  bars[14] = bar(14, 100.65, 100.9, 100.18, 100.62);
  bars[15] = bar(15, 100.7, 100.95, 100.55, 100.75);
  bars[21] = bar(21, 100.7, 100.9, 100.22, 100.60);
  bars[22] = bar(22, 100.55, 100.75, 100.25, 100.38);
  bars[23] = bar(23, 100.35, 100.42, 99.25, 99.35);
  return bars;
}

function mirror(bars) {
  return bars.map((x, i) => bar(i, 200 - x.open, 200 - x.low, 200 - x.high, 200 - x.close));
}

test('confirmed resistance break arms RBS buy limit without AI', () => {
  const m5 = mirror(bearishBars());
  const downM15 = [];
  for (let i = 0; i < 16; i++) downM15.push(bar(i, 104 - i * 0.25, 104.2 - i * 0.25, 103.4 - i * 0.25, 103.7 - i * 0.25));
  const m15 = mirror(downM15);
  const snapshot = {
    symbol: 'XAUUSD', timeframe: 'M1', timestamp: m5[m5.length - 1].timestamp,
    bid: 100.41, ask: 100.65, spread_points: 240,
    features: { m5_candles: m5, m15_candles: m15, point_size: 0.001, digits: 3 }
  };
  const result = detectSbrRbsSetup(snapshot);
  assert.equal(result.state, 'RBS_ARMED');
  assert.equal(result.candidate.setup, 'RBS_RETEST');
  assert.equal(result.candidate.side, 'BUY');
  assert.equal(result.candidate.order_type, 'BUY_LIMIT');
  assert.ok(result.candidate.setup_score >= 70);
  assert.ok(result.candidate.rr >= 1.5);
});
