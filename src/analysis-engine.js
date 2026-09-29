import crypto from 'crypto';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));

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
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function regression(values) {
  const points = values.map((value, index) => ({ x: index, y: finite(value) })).filter(point => point.y !== null);
  if (points.length < 4) return null;
  const n = points.length;
  const sx = points.reduce((sum, point) => sum + point.x, 0);
  const sy = points.reduce((sum, point) => sum + point.y, 0);
  const sxx = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const sxy = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const denominator = n * sxx - sx * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / denominator;
  const intercept = (sy - slope * sx) / n;
  const rmse = Math.sqrt(points.reduce((sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2, 0) / n);
  return { slope, intercept, rmse, at: x => intercept + slope * x };
}

function trendState(bars, atrValue, lookback = 8) {
  const slice = (bars || []).slice(-lookback);
  if (slice.length < 4 || !atrValue) return { label: 'UNKNOWN', strength: 0, slope_atr: 0 };
  const fit = regression(slice.map(bar => bar.close));
  if (!fit) return { label: 'UNKNOWN', strength: 0, slope_atr: 0 };
  const slopeAtr = fit.slope / atrValue;
  const magnitude = Math.abs(slopeAtr);
  const label = slopeAtr > 0.045 ? 'BULLISH' : slopeAtr < -0.045 ? 'BEARISH' : 'RANGE';
  const strength = Math.round(clamp(magnitude / 0.16 * 100, 0, 100));
  return { label, strength, slope_atr: slopeAtr };
}

function swingPoints(bars, field, radius = 2) {
  const out = [];
  for (let i = radius; i < bars.length - radius; i++) {
    const price = finite(bars[i]?.[field]);
    if (price === null) continue;
    let valid = true;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j === i) continue;
      const other = finite(bars[j]?.[field]);
      if (other === null) continue;
      if (field === 'low' ? other < price : other > price) { valid = false; break; }
    }
    if (valid) out.push({ index: i, price, timestamp: bars[i]?.timestamp || null });
  }
  return out;
}

function nearestLevels(bars, price, atrValue, digits) {
  const lows = swingPoints(bars, 'low').filter(point => point.price < price).sort((a, b) => b.price - a.price);
  const highs = swingPoints(bars, 'high').filter(point => point.price > price).sort((a, b) => a.price - b.price);
  const support = lows[0] || null;
  const resistance = highs[0] || null;
  return {
    support: support ? { price: round(support.price, digits), distance_atr: round((price - support.price) / atrValue, 2) } : null,
    resistance: resistance ? { price: round(resistance.price, digits), distance_atr: round((resistance.price - price) / atrValue, 2) } : null
  };
}

function srWatches(levels) {
  const watches = [];
  if (levels.support && levels.support.distance_atr <= 0.75) watches.push({
    type: 'SUPPORT_PROXIMITY', timeframe: 'M15', status: levels.support.distance_atr <= 0.3 ? 'ARMED' : 'FORMING',
    quality: Math.round(clamp(78 - levels.support.distance_atr * 35, 40, 90)), level: levels.support.price,
    distance_atr: levels.support.distance_atr,
    thesis: `Price is ${levels.support.distance_atr} ATR above the nearest confirmed M15 swing support at ${levels.support.price}. Tradevice is watching for either rejection or a confirmed break that can become SBR.`
  });
  if (levels.resistance && levels.resistance.distance_atr <= 0.75) watches.push({
    type: 'RESISTANCE_PROXIMITY', timeframe: 'M15', status: levels.resistance.distance_atr <= 0.3 ? 'ARMED' : 'FORMING',
    quality: Math.round(clamp(78 - levels.resistance.distance_atr * 35, 40, 90)), level: levels.resistance.price,
    distance_atr: levels.resistance.distance_atr,
    thesis: `Price is ${levels.resistance.distance_atr} ATR below the nearest confirmed M15 swing resistance at ${levels.resistance.price}. Tradevice is watching for rejection or a confirmed break that can become RBS.`
  });
  return watches;
}

function watchFingerprint(watch) {
  const raw = `${watch.type}|${watch.timeframe}|${watch.level ?? ''}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

export function analyzeMarketStructure(snapshot) {
  const m5 = Array.isArray(snapshot?.features?.m5_candles) ? snapshot.features.m5_candles : [];
  const m15 = Array.isArray(snapshot?.features?.m15_candles) ? snapshot.features.m15_candles : [];
  const digits = Number(snapshot?.features?.digits ?? 3);
  const price = finite(snapshot?.bid) ?? finite(m5.at(-1)?.close) ?? finite(m15.at(-1)?.close);
  const atrM5 = atr(m5, 14);
  const atrM15 = atr(m15, 14);
  if (price === null) return { state: 'WAITING_FOR_PRICE', watches: [], summary: 'Waiting for live market price.' };

  const trendM5 = trendState(m5, atrM5, 10);
  const trendM15 = trendState(m15, atrM15, 8);
  const levels = atrM15 && m15.length >= 8 ? nearestLevels(m15, price, atrM15, digits) : { support: null, resistance: null };
  const watches = (atrM15 ? srWatches(levels) : [])
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 5)
    .map(watch => ({ ...watch, fingerprint: watchFingerprint(watch) }));

  let bias = 'NEUTRAL';
  if (trendM5.label === 'BULLISH' && trendM15.label === 'BULLISH') bias = 'BULLISH';
  else if (trendM5.label === 'BEARISH' && trendM15.label === 'BEARISH') bias = 'BEARISH';
  else if (trendM15.label === 'BULLISH') bias = 'BULLISH_LEAN';
  else if (trendM15.label === 'BEARISH') bias = 'BEARISH_LEAN';

  const armed = watches.filter(watch => watch.status === 'ARMED').length;
  const forming = watches.filter(watch => watch.status === 'FORMING').length;
  const summary = `XAUUSD structure scan: M5 ${trendM5.label.toLowerCase()}, M15 ${trendM15.label.toLowerCase()}, overall bias ${bias.replaceAll('_', ' ').toLowerCase()}. ${armed ? `${armed} key-level watch${armed === 1 ? '' : 'es'} armed.` : forming ? `${forming} key-level structure${forming === 1 ? '' : 's'} forming.` : 'No actionable key-level structure is close enough yet.'}`;

  return {
    state: armed ? 'ARMED' : watches.length ? 'FORMING' : 'SCANNING',
    bias,
    price: round(price, digits),
    spread_points: finite(snapshot?.spread_points),
    atr_m5: atrM5 ? round(atrM5, digits) : null,
    atr_m15: atrM15 ? round(atrM15, digits) : null,
    trend_m5: trendM5,
    trend_m15: trendM15,
    levels,
    watches,
    summary,
    scanned_at: snapshot?.timestamp || new Date().toISOString()
  };
}
