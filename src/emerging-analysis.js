import { buildPatternDrawing } from './drawing-engine.js';
import { catalogEntry, familyForPattern, qualityProfile, KNOWLEDGE_VERSION } from './knowledge/technical-pattern-knowledge.js';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));

function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const out = [];
  const start = Math.max(1, bars.length - period);
  for (let i = start; i < bars.length; i++) {
    const high = finite(bars[i]?.high);
    const low = finite(bars[i]?.low);
    const previousClose = finite(bars[i - 1]?.close);
    if (high === null || low === null || previousClose === null) continue;
    out.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return out.length ? out.reduce((sum, value) => sum + value, 0) / out.length : null;
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
  return { slope, intercept, at: x => intercept + slope * x };
}

function compactBars(bars) {
  return (bars || []).slice(-24).map(bar => ({
    timestamp: bar.timestamp,
    open: finite(bar.open), high: finite(bar.high), low: finite(bar.low), close: finite(bar.close)
  })).filter(bar => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

function targetWindow(distance, bars, timeframeMinutes = 15) {
  const ranges = (bars || []).slice(-16).map(bar => finite(bar.high) - finite(bar.low)).filter(value => Number.isFinite(value) && value > 0);
  const avg = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : null;
  if (!avg || !(distance > 0)) return null;
  const estimatedCandles = clamp(distance / Math.max(avg * 0.68, 1e-9), 1, 32);
  return {
    min_minutes: Math.max(timeframeMinutes, Math.round(estimatedCandles * 0.7 * timeframeMinutes)),
    max_minutes: Math.round(estimatedCandles * 1.7 * timeframeMinutes)
  };
}

function expiresAt(timestamp, candles = 8, timeframeMinutes = 15) {
  const parsed = Date.parse(timestamp || '');
  return Number.isFinite(parsed) ? new Date(parsed + candles * timeframeMinutes * 60_000).toISOString() : null;
}

function channelGeometry(m15, digits) {
  const bars = (m15 || []).slice(-15, -1);
  if (bars.length < 10) return null;
  const upper = regression(bars.map(bar => bar.high));
  const lower = regression(bars.map(bar => bar.low));
  if (!upper || !lower) return null;
  const x = bars.length;
  return {
    upper: { start: round(upper.at(0), digits), end: round(upper.at(x), digits) },
    lower: { start: round(lower.at(0), digits), end: round(lower.at(x), digits) },
    upperNow: upper.at(x), lowerNow: lower.at(x), slope: (upper.slope + lower.slope) / 2
  };
}

function trendlineGeometry(m15, type, digits) {
  const bars = (m15 || []).slice(-14, -1);
  if (bars.length < 10) return null;
  const useHigh = String(type).includes('RESISTANCE');
  const line = regression(bars.map(bar => bar[useHigh ? 'high' : 'low']));
  if (!line) return null;
  const x = bars.length;
  return {
    trendline: { start: round(line.at(0), digits), end: round(line.at(x), digits) },
    level: line.at(x)
  };
}

function rrTarget(side, entry, stop, multiple = 1.8) {
  const risk = Math.abs(entry - stop);
  return side === 'BUY' ? entry + risk * multiple : entry - risk * multiple;
}

function makeProjection({ side, entry, stop, target, detectedAt, m15, whatNext, label, digits, expiryCandles = 8 }) {
  const distance = Math.abs(target - entry);
  return {
    label,
    side,
    entry: round(entry, digits),
    stop: round(stop, digits),
    target: round(target, digits),
    target_window: targetWindow(distance, m15, 15),
    expires_at: expiresAt(detectedAt, expiryCandles, 15),
    what_next: whatNext,
    actionable: false,
    note: 'Projection only. No order is created until the detector reaches CONFIRMED and passes risk validation.'
  };
}

export function enrichEmergingWatches(snapshot, analysis, watches = []) {
  const m15 = Array.isArray(snapshot?.features?.m15_candles) ? snapshot.features.m15_candles : [];
  const digits = Number(snapshot?.features?.digits ?? 3);
  const atrM15 = finite(analysis?.atr_m15) ?? atr(m15, 14);
  const current = finite(analysis?.price) ?? finite(snapshot?.bid) ?? finite(m15.at(-1)?.close);
  if (!atrM15 || current === null) return watches;
  const detectedAt = snapshot?.timestamp || new Date().toISOString();
  const visualBase = { timeframe: 'M15', candles: compactBars(m15) };
  const trend = String(analysis?.trend_m15?.label || 'RANGE');

  return watches.map(original => {
    const watch = { ...original };
    const type = String(watch.type || '');
    let projection = null;
    let visual = { ...visualBase, ...(watch.visual || {}) };

    if (type === 'SUPPORT_PROXIMITY' && finite(watch.level) !== null) {
      const level = Number(watch.level);
      const bearishBreak = trend === 'BEARISH';
      const side = bearishBreak ? 'SELL' : 'BUY';
      const entry = bearishBreak ? level - atrM15 * 0.10 : level + atrM15 * 0.12;
      const stop = bearishBreak ? level + atrM15 * 0.48 : level - atrM15 * 0.42;
      const structuralTarget = bearishBreak ? null : finite(analysis?.levels?.resistance?.price);
      const target = structuralTarget && structuralTarget > entry ? structuralTarget : rrTarget(side, entry, stop, 1.9);
      projection = makeProjection({ side, entry, stop, target, detectedAt, m15, digits, expiryCandles: 6,
        label: bearishBreak ? 'Support Breakout Emerging' : 'Support Rejection Emerging',
        whatNext: bearishBreak
          ? `Wait for an M15 close below ${round(level, digits)} with a meaningful candle body and at least 0.10 ATR displacement.`
          : `Wait for an M15 rejection of ${round(level, digits)} and a close back above the support trigger zone.` });
      visual.horizontal = [{ label: 'Support', value: round(level, digits) }];
    }

    if (type === 'RESISTANCE_PROXIMITY' && finite(watch.level) !== null) {
      const level = Number(watch.level);
      const bullishBreak = trend === 'BULLISH';
      const side = bullishBreak ? 'BUY' : 'SELL';
      const entry = bullishBreak ? level + atrM15 * 0.10 : level - atrM15 * 0.12;
      const stop = bullishBreak ? level - atrM15 * 0.48 : level + atrM15 * 0.42;
      const structuralTarget = bullishBreak ? null : finite(analysis?.levels?.support?.price);
      const target = structuralTarget && structuralTarget < entry ? structuralTarget : rrTarget(side, entry, stop, 1.9);
      projection = makeProjection({ side, entry, stop, target, detectedAt, m15, digits, expiryCandles: 6,
        label: bullishBreak ? 'Resistance Breakout Emerging' : 'Resistance Rejection Emerging',
        whatNext: bullishBreak
          ? `Wait for an M15 close above ${round(level, digits)} with a meaningful candle body and at least 0.10 ATR displacement.`
          : `Wait for an M15 rejection of ${round(level, digits)} and a close back below the resistance trigger zone.` });
      visual.horizontal = [{ label: 'Resistance', value: round(level, digits) }];
    }

    if (type === 'DESCENDING_RESISTANCE_TRENDLINE' || type === 'ASCENDING_SUPPORT_TRENDLINE') {
      const geometry = watch.geometry?.trendline
        ? { trendline: watch.geometry.trendline, level: finite(watch.level) ?? finite(watch.geometry.trendline.end) }
        : trendlineGeometry(m15, type, digits);
      if (geometry) {
        const side = type.startsWith('DESCENDING') ? 'BUY' : 'SELL';
        const level = geometry.level;
        const entry = side === 'BUY' ? level + atrM15 * 0.10 : level - atrM15 * 0.10;
        const stop = side === 'BUY' ? level - atrM15 * 0.48 : level + atrM15 * 0.48;
        const target = rrTarget(side, entry, stop, 2.0);
        projection = makeProjection({ side, entry, stop, target, detectedAt, m15, digits,
          label: side === 'BUY' ? 'Descending Trendline Breakout Emerging' : 'Ascending Trendline Breakout Emerging',
          whatNext: `Wait for an M15 close ${side === 'BUY' ? 'above' : 'below'} the projected trendline near ${round(level, digits)} with breakout displacement. A wick alone does not confirm the setup.` });
        visual.trendline = geometry.trendline;
      }
    }

    if (type.startsWith('CHANNEL_')) {
      const geometry = watch.geometry?.upper && watch.geometry?.lower
        ? {
            upper: watch.geometry.upper,
            lower: watch.geometry.lower,
            upperNow: Number(watch.geometry.upper.end),
            lowerNow: Number(watch.geometry.lower.end),
            slope: ((Number(watch.geometry.upper.end) - Number(watch.geometry.upper.start)) + (Number(watch.geometry.lower.end) - Number(watch.geometry.lower.start))) / Math.max((m15.length - 1) * 2, 1)
          }
        : channelGeometry(m15, digits);
      if (geometry) {
        const direction = type.replace('CHANNEL_', '');
        const side = direction === 'DOWN' ? 'SELL' : direction === 'UP' ? 'BUY' : (trend === 'BEARISH' ? 'SELL' : 'BUY');
        const entry = current;
        const boundary = side === 'BUY' ? geometry.upperNow : geometry.lowerNow;
        const stop = side === 'BUY' ? Math.min(geometry.lowerNow, entry - atrM15 * 0.65) : Math.max(geometry.upperNow, entry + atrM15 * 0.65);
        let target = boundary;
        if ((side === 'BUY' && target <= entry) || (side === 'SELL' && target >= entry)) target = rrTarget(side, entry, stop, 1.6);
        projection = makeProjection({ side, entry, stop, target, detectedAt, m15, digits,
          label: `${type.replaceAll('_', ' ')} Emerging`,
          whatNext: direction === 'DOWN'
            ? `Channel remains descending. Watch for rejection below the upper boundary or an M15 close through a channel boundary before this becomes actionable.`
            : direction === 'UP'
              ? `Channel remains ascending. Watch for support at the lower boundary or an M15 close through a channel boundary before this becomes actionable.`
              : 'Range channel is intact. Wait for a boundary rejection or confirmed breakout before creating an Offering.' });
        visual.upper = geometry.upper;
        visual.lower = geometry.lower;
      }
    }

    const detected = watch.detected_at || detectedAt;
    const patternInfo = catalogEntry(type);
    const familyInfo = familyForPattern(type);
    const baseQuality = qualityProfile({
      quality: watch.quality,
      trendStrength: analysis?.trend_m15?.strength,
      distanceAtr: watch.distance_atr,
      status: watch.status
    });
    const qc = watch.quality_components || {};
    const quality = {
      ...baseQuality,
      quality: finite(watch.quality) !== null ? clamp(Number(watch.quality) / 100, 0, 1) : baseQuality.quality,
      clarity: finite(qc.clarity) !== null ? clamp(qc.clarity, 0, 1) : baseQuality.clarity,
      initial_trend: finite(qc.initial_trend) !== null ? clamp(qc.initial_trend, 0, 1) : baseQuality.initial_trend,
      uniformity: finite(qc.uniformity) !== null ? clamp(qc.uniformity, 0, 1) : baseQuality.uniformity,
      touch_quality: finite(qc.touch_quality) !== null ? clamp(qc.touch_quality, 0, 1) : null,
      containment: finite(qc.containment) !== null ? clamp(qc.containment, 0, 1) : null,
      breakout: watch.breakout_metrics?.valid ? clamp((Number(watch.breakout_metrics.displacement || 0) / 0.55) * 0.5 + Number(watch.breakout_metrics.closeExtreme || 0) * 0.5, 0, 1) : baseQuality.breakout,
      readiness: String(watch.status || '').toUpperCase() === 'CONFIRMED' ? 1 : baseQuality.readiness
    };
    const enrichedWatch = { ...watch, projection, visual: projection ? visual : watch.visual ?? null, detected_at: detected };
    const drawing = projection ? buildPatternDrawing({
      watch: enrichedWatch,
      projection,
      candles: visual.candles || [],
      detectedAt: detected,
      intervalMinutes: 15,
      patternFamily: familyInfo.id
    }) : null;
    return {
      ...enrichedWatch,
      knowledge: {
        version: KNOWLEDGE_VERSION,
        family: familyInfo.id,
        family_label: familyInfo.label,
        pattern: patternInfo,
        quality,
        diagnostics: {
          touches: watch.touches ?? null,
          distance_atr: watch.distance_atr ?? null,
          trigger_failed: watch.trigger_failed ?? null,
          breakout_metrics: watch.breakout_metrics ?? null,
          rr: watch.rr ?? null
        }
      },
      drawing
    };
  });
}
