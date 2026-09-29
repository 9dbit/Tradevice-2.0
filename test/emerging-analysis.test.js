import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichEmergingWatches } from '../src/emerging-analysis.js';

function bars({ start = 4100, slope = 0.5, count = 24 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const base = start + slope * index;
    return {
      timestamp: new Date(Date.parse('2026-09-29T00:00:00Z') + index * 15 * 60_000).toISOString(),
      open: base,
      high: base + 1.2,
      low: base - 1.0,
      close: base + 0.45
    };
  });
}

test('bullish resistance proximity creates an emerging breakout projection', () => {
  const m15 = bars({ start: 4100, slope: 0.35 });
  const snapshot = { timestamp: '2026-09-29T06:00:00Z', bid: 4108.0, features: { digits: 3, m15_candles: m15 } };
  const analysis = {
    price: 4108.0,
    atr_m15: 2.2,
    trend_m15: { label: 'BULLISH' },
    levels: { support: { price: 4103.5 }, resistance: { price: 4108.6 } }
  };
  const [watch] = enrichEmergingWatches(snapshot, analysis, [{ type:'RESISTANCE_PROXIMITY', timeframe:'M15', status:'ARMED', quality:82, level:4108.6 }]);
  assert.equal(watch.projection.label, 'Resistance Breakout Emerging');
  assert.equal(watch.projection.side, 'BUY');
  assert.ok(watch.projection.entry > 4108.6);
  assert.ok(watch.projection.stop < watch.projection.entry);
  assert.ok(watch.projection.target > watch.projection.entry);
  assert.ok(watch.projection.expires_at);
  assert.ok(watch.projection.target_window.max_minutes >= watch.projection.target_window.min_minutes);
  assert.equal(watch.projection.actionable, false);
});

test('descending channel produces a bearish emerging continuation projection', () => {
  const m15 = bars({ start: 4145, slope: -0.45 });
  const snapshot = { timestamp: '2026-09-29T06:00:00Z', bid: 4134.2, features: { digits: 3, m15_candles: m15 } };
  const analysis = {
    price: 4134.2,
    atr_m15: 2.4,
    trend_m15: { label: 'BEARISH' },
    levels: { support: null, resistance: null }
  };
  const [watch] = enrichEmergingWatches(snapshot, analysis, [{ type:'CHANNEL_DOWN', timeframe:'M15', status:'ARMED', quality:88 }]);
  assert.equal(watch.projection.label, 'CHANNEL DOWN Emerging');
  assert.equal(watch.projection.side, 'SELL');
  assert.ok(Number.isFinite(watch.projection.entry));
  assert.ok(watch.projection.stop > watch.projection.entry);
  assert.ok(watch.projection.target < watch.projection.entry);
  assert.ok(watch.visual.upper && watch.visual.lower);
});
