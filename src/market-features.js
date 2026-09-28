export const PIPELINE_VERSIONS = Object.freeze({
  strategy: 'shadow-v1',
  prompt: 'xau-m1-p1',
  features: 'xau-features-v1',
  prefilter: 'xau-prefilter-v1',
  risk_policy: 'risk-v1'
});

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const closes = bars => bars.map(x => finite(x?.close)).filter(x => x !== null);

function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const start = Math.max(1, bars.length - period);
  const values = [];
  for (let i = start; i < bars.length; i++) {
    const h = finite(bars[i]?.high), l = finite(bars[i]?.low), pc = finite(bars[i - 1]?.close);
    if (h === null || l === null || pc === null) continue;
    values.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function slope(bars, lookback = 8) {
  const c = closes(bars).slice(-lookback);
  if (c.length < 2) return null;
  return (c[c.length - 1] - c[0]) / (c.length - 1);
}

function ema(bars, period = 12) {
  const c = closes(bars);
  if (!c.length) return null;
  const k = 2 / (period + 1);
  let value = c[0];
  for (let i = 1; i < c.length; i++) value = c[i] * k + value * (1 - k);
  return value;
}

function session(timestamp) {
  const d = new Date(timestamp);
  const hour = Number.isFinite(d.getTime()) ? d.getUTCHours() : 0;
  const wibHour = (hour + 7) % 24;
  let label = 'OFF_HOURS';
  if (hour >= 0 && hour < 7) label = 'ASIA';
  else if (hour >= 7 && hour < 12) label = 'LONDON';
  else if (hour >= 12 && hour < 16) label = 'LONDON_NY_OVERLAP';
  else if (hour >= 16 && hour < 21) label = 'NEW_YORK';
  return { label, utc_hour: hour, wib_hour: wibHour };
}

function latestCandle(bars) {
  const c = bars?.[bars.length - 1];
  if (!c) return {};
  const o = finite(c.open), h = finite(c.high), l = finite(c.low), close = finite(c.close);
  if ([o, h, l, close].some(x => x === null)) return {};
  const body = Math.abs(close - o);
  const range = Math.max(0, h - l);
  return {
    open: o, high: h, low: l, close,
    range, body,
    upper_wick: Math.max(0, h - Math.max(o, close)),
    lower_wick: Math.max(0, Math.min(o, close) - l),
    direction: close > o ? 'UP' : close < o ? 'DOWN' : 'FLAT'
  };
}

function swingContext(bars, lookback = 12) {
  const prior = Array.isArray(bars) ? bars.slice(-(lookback + 1), -1) : [];
  const last = bars?.[bars.length - 1];
  if (!prior.length || !last) return {};
  const highs = prior.map(x => finite(x.high)).filter(x => x !== null);
  const lows = prior.map(x => finite(x.low)).filter(x => x !== null);
  if (!highs.length || !lows.length) return {};
  const swingHigh = Math.max(...highs), swingLow = Math.min(...lows);
  const h = finite(last.high), l = finite(last.low), c = finite(last.close), o = finite(last.open);
  const breakHigh = h !== null && h > swingHigh;
  const breakLow = l !== null && l < swingLow;
  return {
    swing_high: swingHigh,
    swing_low: swingLow,
    break_high: breakHigh,
    break_low: breakLow,
    sweep_high: breakHigh && c !== null && c < swingHigh,
    sweep_low: breakLow && c !== null && c > swingLow,
    bullish_reclaim: l !== null && o !== null && c !== null && l < swingLow && c > o,
    bearish_reclaim: h !== null && o !== null && c !== null && h > swingHigh && c < o
  };
}

export function extractMarketFeatures(snapshot) {
  const m1 = snapshot?.candles ?? [];
  const m5 = snapshot?.features?.m5_candles ?? [];
  const m15 = snapshot?.features?.m15_candles ?? [];
  const a1 = atr(m1), a5 = atr(m5), a15 = atr(m15);
  const candle = latestCandle(m1);
  const swings = swingContext(m1);
  const e = ema(m1, 12);
  const s5 = slope(m5, 8), s15 = slope(m15, 6);
  const spread = finite(snapshot?.spread_points);
  const point = finite(snapshot?.features?.point_size);
  const mid = finite(snapshot?.bid) !== null && finite(snapshot?.ask) !== null
    ? (finite(snapshot.bid) + finite(snapshot.ask)) / 2 : candle.close ?? null;
  const normalizedSpread = spread !== null && point && a1 ? spread * point / a1 : null;
  const rangeAtr = a1 && candle.range !== undefined ? candle.range / a1 : null;
  let volatility = 'UNKNOWN';
  if (rangeAtr !== null) volatility = rangeAtr >= 2 ? 'EXTREME' : rangeAtr >= 1.25 ? 'HIGH' : rangeAtr <= 0.45 ? 'LOW' : 'NORMAL';
  let trend = 'FLAT';
  if (s5 !== null && s15 !== null) trend = s5 > 0 && s15 > 0 ? 'UP' : s5 < 0 && s15 < 0 ? 'DOWN' : 'MIXED';

  return {
    version: PIPELINE_VERSIONS.features,
    session: session(snapshot?.timestamp),
    atr: { m1: a1, m5: a5, m15: a15 },
    latest_candle: candle,
    swings,
    ema12_m1: e,
    distance_to_ema12: mid !== null && e !== null ? mid - e : null,
    slope: { m5: s5, m15: s15 },
    trend_alignment: trend,
    volatility,
    range_atr_ratio: rangeAtr,
    normalized_spread_atr: normalizedSpread,
    spread_points: spread,
    broker_symbol: snapshot?.features?.broker_symbol ?? null,
    terminal_connected: snapshot?.features?.terminal_connected ?? null,
    bars: { m1: m1.length, m5: m5.length, m15: m15.length }
  };
}

export function prefilterSnapshot(snapshot, features = extractMarketFeatures(snapshot)) {
  const reasons = [];
  const maxSpread = Number(process.env.MAX_SPREAD_POINTS || 300);
  if (snapshot?.timeframe !== 'M1') reasons.push('NOT_M1');
  if (features.bars.m1 < 30 || features.bars.m5 < 20 || features.bars.m15 < 10) reasons.push('INSUFFICIENT_BARS');
  if (features.spread_points === null || features.spread_points > maxSpread) reasons.push('SPREAD_TOO_WIDE');
  if (features.terminal_connected === false) reasons.push('TERMINAL_DISCONNECTED');
  if (!features.atr.m1 || !features.atr.m5) reasons.push('ATR_UNAVAILABLE');

  const triggerCodes = [];
  if (features.swings.sweep_high || features.swings.sweep_low) triggerCodes.push('LIQUIDITY_SWEEP');
  if (features.swings.break_high || features.swings.break_low) triggerCodes.push('STRUCTURE_BREAK');
  if (features.range_atr_ratio !== null && features.range_atr_ratio >= 1.15) triggerCodes.push('VOLATILITY_EXPANSION');
  if (features.trend_alignment === 'UP' || features.trend_alignment === 'DOWN') {
    const d = Math.abs(features.distance_to_ema12 ?? Infinity);
    if (features.atr.m1 && d <= features.atr.m1 * 0.55) triggerCodes.push('TREND_PULLBACK_ZONE');
  }
  if (!triggerCodes.length) reasons.push('NO_SETUP_TRIGGER');

  return {
    version: PIPELINE_VERSIONS.prefilter,
    should_call_ai: reasons.length === 0,
    reasons,
    trigger_codes: triggerCodes,
    features
  };
}
