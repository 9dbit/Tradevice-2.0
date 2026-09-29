import crypto from 'crypto';

const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round = (v, d = 3) => Number(Number(v).toFixed(d));

function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const values = [];
  const start = Math.max(1, bars.length - period);
  for (let i = start; i < bars.length; i++) {
    const high = finite(bars[i]?.high);
    const low = finite(bars[i]?.low);
    const previousClose = finite(bars[i - 1]?.close);
    if (high === null || low === null || previousClose === null) continue;
    values.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function slope(bars, lookback = 8) {
  const closes = (bars || []).slice(-lookback).map(x => finite(x?.close)).filter(x => x !== null);
  return closes.length >= 2 ? (closes[closes.length - 1] - closes[0]) / (closes.length - 1) : 0;
}

function swingPoints(bars, side, radius = 2) {
  const field = side === 'support' ? 'low' : 'high';
  const out = [];
  for (let i = radius; i < bars.length - radius; i++) {
    const price = finite(bars[i]?.[field]);
    if (price === null) continue;
    let swing = true;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j === i) continue;
      const other = finite(bars[j]?.[field]);
      if (other === null) continue;
      if (side === 'support' ? other < price : other > price) {
        swing = false;
        break;
      }
    }
    if (swing) out.push({ index: i, price, timestamp: bars[i]?.timestamp || null });
  }
  return out;
}

function buildZones(bars, side, atrValue) {
  const tolerance = Math.max(atrValue * 0.20, 1e-9);
  const padding = atrValue * 0.06;
  const points = swingPoints(bars, side).sort((a, b) => a.price - b.price);
  const clusters = [];

  for (const point of points) {
    let best = null;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = Math.abs(point.price - cluster.center);
      if (distance <= tolerance && distance < bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }
    if (!best) {
      clusters.push({ center: point.price, points: [point] });
      continue;
    }
    best.points.push(point);
    best.center = best.points.reduce((sum, x) => sum + x.price, 0) / best.points.length;
  }

  return clusters.map(cluster => {
    const separated = [];
    for (const point of [...cluster.points].sort((a, b) => a.index - b.index)) {
      if (!separated.length || point.index - separated[separated.length - 1].index >= 3) separated.push(point);
    }
    if (separated.length < 2) return null;
    const prices = separated.map(x => x.price);
    return {
      side,
      low: Math.min(...prices) - padding,
      high: Math.max(...prices) + padding,
      center: prices.reduce((a, b) => a + b, 0) / prices.length,
      touches: separated.length,
      last_touch_index: separated[separated.length - 1].index
    };
  }).filter(Boolean);
}

function trendScore(direction, m5, m15) {
  const m5Slope = slope(m5, 8);
  const m15Slope = slope(m15, 6);
  const wantsUp = direction === 'BUY';
  const m5Aligned = wantsUp ? m5Slope > 0 : m5Slope < 0;
  const m15Aligned = wantsUp ? m15Slope > 0 : m15Slope < 0;
  return m5Aligned && m15Aligned ? 20 : m5Aligned || m15Aligned ? 12 : 5;
}

function targetFor(direction, entry, atrValue, supportZones, resistanceZones, priorBars) {
  if (direction === 'SELL') {
    const zones = supportZones
      .filter(zone => zone.high < entry - atrValue * 0.35)
      .sort((a, b) => b.high - a.high);
    if (zones.length) return zones[0].high + atrValue * 0.05;
    const lows = priorBars.slice(-24).map(x => finite(x.low)).filter(x => x !== null && x < entry - atrValue * 0.5);
    return lows.length ? Math.min(...lows) + atrValue * 0.05 : null;
  }

  const zones = resistanceZones
    .filter(zone => zone.low > entry + atrValue * 0.35)
    .sort((a, b) => a.low - b.low);
  if (zones.length) return zones[0].low - atrValue * 0.05;
  const highs = priorBars.slice(-24).map(x => finite(x.high)).filter(x => x !== null && x > entry + atrValue * 0.5);
  return highs.length ? Math.max(...highs) - atrValue * 0.05 : null;
}

function fingerprint(type, zone, breakCandle, digits) {
  const source = JSON.stringify({
    type,
    low: round(zone.low, digits),
    high: round(zone.high, digits),
    break_timestamp: breakCandle?.timestamp || null
  });
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 18);
}

function candidateFromBreak({ type, zone, last, previous, atrValue, snapshot, supportZones, resistanceZones, priorBars, m5, m15, digits }) {
  const direction = type === 'SBR' ? 'SELL' : 'BUY';
  const high = finite(last.high);
  const low = finite(last.low);
  const close = finite(last.close);
  const open = finite(last.open);
  if ([high, low, close, open].some(v => v === null)) return null;

  const range = Math.max(1e-9, high - low);
  const body = Math.abs(close - open);
  const bodyRatio = body / range;
  const closePosition = direction === 'SELL' ? (close - low) / range : (high - close) / range;
  const displacement = direction === 'SELL' ? (zone.low - close) / atrValue : (close - zone.high) / atrValue;
  const previousClose = finite(previous?.close);
  const freshBreak = direction === 'SELL'
    ? previousClose !== null && previousClose >= zone.low - atrValue * 0.10
    : previousClose !== null && previousClose <= zone.high + atrValue * 0.10;
  const broken = direction === 'SELL'
    ? close < zone.low - atrValue * 0.15
    : close > zone.high + atrValue * 0.15;

  if (!freshBreak || !broken || bodyRatio < 0.55 || closePosition > 0.35) return null;

  const width = Math.max(zone.high - zone.low, atrValue * 0.08);
  const entry = direction === 'SELL' ? zone.low + width * 0.40 : zone.high - width * 0.40;
  const pointSize = finite(snapshot?.features?.point_size) || 0.001;
  const spreadDistance = (finite(snapshot?.spread_points) || 0) * pointSize;
  const stopBuffer = atrValue * 0.18 + spreadDistance;
  const stopLoss = direction === 'SELL' ? zone.high + stopBuffer : zone.low - stopBuffer;
  const takeProfit = targetFor(direction, entry, atrValue, supportZones, resistanceZones, priorBars);
  if (takeProfit === null) return null;

  const risk = direction === 'SELL' ? stopLoss - entry : entry - stopLoss;
  const reward = direction === 'SELL' ? entry - takeProfit : takeProfit - entry;
  if (!(risk > 0 && reward > 0)) return null;
  const rewardRisk = reward / risk;
  const minimumRewardRisk = Number(process.env.SBR_RBS_MIN_RR || 1.50);
  if (rewardRisk < minimumRewardRisk) return null;

  const bid = finite(snapshot?.bid);
  const ask = finite(snapshot?.ask);
  if (direction === 'SELL' && bid !== null && entry <= bid) return null;
  if (direction === 'BUY' && ask !== null && entry >= ask) return null;

  const zoneScore = Math.min(25, 10 + zone.touches * 5);
  const breakScore = clamp(10 + bodyRatio * 10 + displacement * 10, 0, 25);
  const alignmentScore = trendScore(direction, m5, m15);
  const distanceAtr = Math.abs(close - entry) / atrValue;
  const geometryScore = distanceAtr <= 1.5 ? 15 : distanceAtr <= 2.5 ? 10 : 5;
  const riskScore = rewardRisk >= 2.5 ? 15 : rewardRisk >= 2 ? 13 : rewardRisk >= 1.5 ? 10 : 6;
  const setupScore = Math.round(clamp(zoneScore + breakScore + alignmentScore + geometryScore + riskScore, 0, 100));
  const minimumScore = Number(process.env.STRUCTURE_MIN_SCORE || 70);
  if (setupScore < minimumScore) return null;

  const setupFingerprint = fingerprint(type, zone, last, digits);
  const setup = type === 'SBR' ? 'SBR_RETEST' : 'RBS_RETEST';
  const state = type === 'SBR' ? 'SBR_ARMED' : 'RBS_ARMED';
  const structuralChange = direction === 'SELL'
    ? 'support broke and is now treated as resistance'
    : 'resistance broke and is now treated as support';
  const thesis = `${type}: ${structuralChange}. Zone ${round(zone.low, digits)}–${round(zone.high, digits)} was built from ${zone.touches} separated M5 swing touches. Break candle closed ${round(displacement, 2)} ATR beyond the zone with ${Math.round(bodyRatio * 100)}% body-to-range. Pending ${direction}_LIMIT waits for a retest into the zone; no LLM analysis was required.`;
  const invalidation = direction === 'SELL'
    ? `Cancel if M5 closes back above ${round(zone.high, digits)} before fill, if target is reached first, or after 6 M5 candles.`
    : `Cancel if M5 closes back below ${round(zone.low, digits)} before fill, if target is reached first, or after 6 M5 candles.`;

  return {
    fingerprint: setupFingerprint,
    state,
    setup,
    side: direction,
    order_type: direction === 'SELL' ? 'SELL_LIMIT' : 'BUY_LIMIT',
    regime: direction === 'SELL' ? 'TREND_DOWN' : 'TREND_UP',
    entry: round(entry, digits),
    stop_loss: round(stopLoss, digits),
    take_profit: round(takeProfit, digits),
    expiration_candles: 6,
    decision_confidence: setupScore / 100,
    entry_confidence: setupScore / 100,
    setup_score: setupScore,
    score_components: {
      zone_strength: Math.round(zoneScore),
      break_quality: Math.round(breakScore),
      trend_alignment: alignmentScore,
      retest_geometry: geometryScore,
      risk_target_room: riskScore
    },
    rr: rewardRisk,
    zone: { low: round(zone.low, digits), high: round(zone.high, digits), touches: zone.touches },
    break_candle_timestamp: last.timestamp || null,
    reason_codes: [type, 'M5_BREAK_CONFIRMED', `ZONE_TOUCHES_${zone.touches}`, `BODY_RATIO_${Math.round(bodyRatio * 100)}`, `RR_${rewardRisk.toFixed(2)}`],
    thesis,
    invalidation
  };
}

export function detectSbrRbsSetup(snapshot) {
  const m5 = Array.isArray(snapshot?.features?.m5_candles) ? snapshot.features.m5_candles : [];
  const m15 = Array.isArray(snapshot?.features?.m15_candles) ? snapshot.features.m15_candles : [];
  if (m5.length < 20) return { state: 'INSUFFICIENT_M5', candidate: null };

  const atrValue = atr(m5, 14);
  if (!atrValue) return { state: 'ATR_UNAVAILABLE', candidate: null };

  const last = m5[m5.length - 1];
  const previous = m5[m5.length - 2];
  const priorBars = m5.slice(0, -1);
  const supportZones = buildZones(priorBars, 'support', atrValue);
  const resistanceZones = buildZones(priorBars, 'resistance', atrValue);
  const digits = Number(snapshot?.features?.digits ?? 3);
  const common = { last, previous, atrValue, snapshot, supportZones, resistanceZones, priorBars, m5: priorBars, m15, digits };
  const candidates = [];

  for (const zone of supportZones) {
    const candidate = candidateFromBreak({ type: 'SBR', zone, ...common });
    if (candidate) candidates.push(candidate);
  }
  for (const zone of resistanceZones) {
    const candidate = candidateFromBreak({ type: 'RBS', zone, ...common });
    if (candidate) candidates.push(candidate);
  }

  candidates.sort((a, b) => b.setup_score - a.setup_score || b.rr - a.rr);
  const candidate = candidates[0] || null;
  return {
    state: candidate?.state || 'NO_EVENT',
    candidate,
    atr_m5: atrValue,
    zones: { support: supportZones.length, resistance: resistanceZones.length },
    scanned_at: snapshot?.timestamp || new Date().toISOString()
  };
}
