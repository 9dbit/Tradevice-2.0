import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMarketFeatures, prefilterSnapshot } from '../src/market-features.js';

function bars(count, start = 4100, step = 0.2, spike = false) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const open = start + i * step;
    const close = open + step * 0.5;
    out.push({
      timestamp: new Date(Date.UTC(2026, 8, 28, 10, i % 60)).toISOString(),
      open,
      high: open + 0.35,
      low: open - 0.25,
      close,
      tick_volume: 100 + i
    });
  }
  if (spike) {
    const last = out[out.length - 1];
    last.high += 3;
    last.close = last.high - 0.1;
  }
  return out;
}

function snapshot(overrides = {}) {
  return {
    symbol: 'XAUUSD',
    timeframe: 'M1',
    timestamp: '2026-09-28T11:38:00Z',
    bid: 4148.95,
    ask: 4149.19,
    spread_points: 240,
    candles: bars(60, 4100, 0.15, true),
    features: {
      point_size: 0.001,
      terminal_connected: true,
      broker_symbol: 'XAUUSDm',
      m5_candles: bars(36, 4090, 0.35),
      m15_candles: bars(16, 4070, 0.7)
    },
    ...overrides
  };
}

test('feature extractor produces versioned session and trigger context', () => {
  const features = extractMarketFeatures(snapshot());
  assert.equal(features.version, 'xau-features-v1');
  assert.equal(features.session.label, 'LONDON');
  assert.equal(features.bars.m1, 60);
  assert.equal(features.broker_symbol, 'XAUUSDm');
  assert.ok(features.atr.m1 > 0);
});

test('prefilter blocks wide spread before any AI call', () => {
  const result = prefilterSnapshot(snapshot({ spread_points: 301 }));
  assert.equal(result.should_call_ai, false);
  assert.ok(result.reasons.includes('SPREAD_TOO_WIDE'));
});

test('prefilter blocks insufficient context bars', () => {
  const s = snapshot();
  s.candles = bars(10);
  const result = prefilterSnapshot(s);
  assert.equal(result.should_call_ai, false);
  assert.ok(result.reasons.includes('INSUFFICIENT_BARS'));
});

test('structure expansion creates an AI-worthy trigger when guardrails pass', () => {
  const result = prefilterSnapshot(snapshot());
  assert.ok(result.trigger_codes.includes('STRUCTURE_BREAK') || result.trigger_codes.includes('VOLATILITY_EXPANSION'));
  assert.equal(result.reasons.includes('SPREAD_TOO_WIDE'), false);
});
