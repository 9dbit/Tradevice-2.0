const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const unix = value => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

function line(name, x1, y1, x2, y2, point1Name = null, point2Name = null) {
  if (![x1,y1,x2,y2].every(value => Number.isFinite(Number(value)))) return null;
  return { name, x1:Number(x1), y1:Number(y1), x2:Number(x2), y2:Number(y2), point1Name, point2Name };
}

function lineFromPricePair(name, pair, x1, x2) {
  if (!pair) return null;
  return line(name, x1, finite(pair.start), x2, finite(pair.end));
}

function timeAtFraction(start, end, fraction) {
  return Math.round(start + (end - start) * fraction);
}

export function buildPatternDrawing({ watch, projection, candles, detectedAt, intervalMinutes = 15, patternFamily = 'CHART_PATTERN' }) {
  const clean = (candles || []).filter(c => [c.open,c.high,c.low,c.close].every(value => finite(value) !== null));
  if (clean.length < 4 || !projection) return null;

  const candleStart = unix(clean[0].timestamp);
  const candleEnd = unix(clean.at(-1).timestamp);
  const detected = unix(detectedAt) ?? candleEnd;
  const expires = unix(projection.expires_at) ?? (detected + intervalMinutes * 60 * 8);
  if (![candleStart,candleEnd,detected,expires].every(Number.isFinite)) return null;

  const drawingLines = [];
  const visual = watch?.visual || {};
  const structureStart = candleStart;
  const structureEnd = detected;

  const upper = lineFromPricePair('Resistance', visual.upper, structureStart, structureEnd);
  const lower = lineFromPricePair('Support', visual.lower, structureStart, structureEnd);
  const trendline = lineFromPricePair(String(watch?.type || '').includes('RESISTANCE') ? 'Resistance' : 'Support', visual.trendline, structureStart, structureEnd);
  if (upper) drawingLines.push(upper);
  if (lower) drawingLines.push(lower);
  if (trendline) drawingLines.push(trendline);

  for (const horizontal of visual.horizontal || []) {
    const value = finite(horizontal?.value);
    if (value === null) continue;
    const item = line(horizontal.label || 'Key Level', structureStart, value, expires, value);
    if (item) drawingLines.push(item);
  }

  const entry = finite(projection.entry);
  const stop = finite(projection.stop);
  const target = finite(projection.target);
  const allPrices = clean.flatMap(c => [finite(c.high), finite(c.low)]).filter(Number.isFinite);
  for (const value of [entry,stop,target]) if (Number.isFinite(value)) allPrices.push(value);
  for (const item of drawingLines) allPrices.push(item.y1,item.y2);
  const low = Math.min(...allPrices);
  const high = Math.max(...allPrices);
  const priceSpan = Math.max(high - low, 0.001);

  const eventLine = line('Event Line', detected, low - priceSpan * 0.08, detected, high + priceSpan * 0.08);
  const targetWindow = projection.target_window || {};
  const maxMinutes = Math.max(intervalMinutes, Number(targetWindow.max_minutes || intervalMinutes * 4));
  const forecastEnd = Math.min(expires, detected + maxMinutes * 60);
  const arrow = entry !== null && target !== null ? [line('Forecast Arrow', detected, entry, forecastEnd, target)] : [];

  const predictionRectangle = [];
  if (target !== null) {
    const tolerance = Math.max(priceSpan * 0.018, Math.abs((target ?? 0) - (entry ?? target)) * 0.08);
    const top = target + tolerance;
    const bottom = target - tolerance;
    const start = Math.min(expires, detected + intervalMinutes * 60);
    predictionRectangle.push(
      line('Prediction Rectangle - Top Line', start, top, expires, top),
      line('Prediction Rectangle - Right Line', expires, top, expires, bottom),
      line('Prediction Rectangle - Bottom Line', expires, bottom, start, bottom),
      line('Prediction Rectangle - Left Line', start, bottom, start, top)
    );
  }

  const forecast = [];
  if (entry !== null && target !== null) {
    const midTime = timeAtFraction(detected, forecastEnd, 0.55);
    const midPrice = entry + (target - entry) * 0.58;
    forecast.push(line('Forecast Path A', detected, entry, midTime, midPrice));
    forecast.push(line('Forecast Path B', midTime, midPrice, forecastEnd, target));
  }

  return {
    schema_version: 'tradevice-drawing-v1',
    chartType: patternFamily,
    interval: intervalMinutes,
    length: clean.length,
    direction: String(projection.side || '').toUpperCase() === 'BUY' ? 'BULLISH' : 'BEARISH',
    priceRange: { low, to: high },
    timeFrame: { from: candleStart, to: Math.max(expires, candleEnd) },
    lines: drawingLines.filter(Boolean),
    eventLine,
    arrow: arrow.filter(Boolean),
    forecast: forecast.filter(Boolean),
    predictionRectangle: predictionRectangle.filter(Boolean),
    signalLevels: { entry, stop_loss: stop, target_level: target },
    candles: clean
  };
}
