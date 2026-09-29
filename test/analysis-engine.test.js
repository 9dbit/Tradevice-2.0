import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketStructure } from '../src/analysis-engine.js';

function bars(count, start = 4100, step = 0.35) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const close = start + i * step + Math.sin(i / 2) * 0.45;
    out.push({
      timestamp: new Date(Date.parse('2026-09-29T00:00:00Z') + i * 15 * 60_000).toISOString(),
      open: close - 0.15,
      high: close + 0.7,
      low: close - 0.65,
      close
    });
  }
  return out;
}

test('live analysis publishes market read even without a confirmed offer', () => {
  const m15 = bars(16, 4100, 0.28);
  const m5 = bars(36, 4106, 0.08).map((bar, index) => ({ ...bar, timestamp: new Date(Date.parse('2026-09-29T00:00:00Z') + index * 5 * 60_000).toISOString() }));
  const snapshot = {
    timestamp: '2026-09-29T04:00:00Z',
    bid: 4104.8,
    ask: 4105.0,
    spread_points: 200,
    features: { digits: 3, m5_candles: m5, m15_candles: m15 }
  };
  const analysis = analyzeMarketStructure(snapshot);
  assert.ok(['SCANNING','FORMING','ARMED'].includes(analysis.state));
  assert.equal(typeof analysis.summary, 'string');
  assert.ok(analysis.summary.includes('XAUUSD structure scan'));
  assert.equal(typeof analysis.trend_m5.label, 'string');
  assert.equal(typeof analysis.trend_m15.label, 'string');
  assert.ok(Array.isArray(analysis.watches));
});
