import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatternDrawing } from '../src/drawing-engine.js';

const candles = Array.from({length:12}, (_,i) => ({
  timestamp: new Date(Date.UTC(2026,8,29,0,i*15)).toISOString(),
  open: 4100+i, high: 4102+i, low: 4099+i, close: 4101+i
}));

test('builds Autochartist-class drawing primitives from Tradevice data', () => {
  const watch = { type:'CHANNEL_UP', visual:{ upper:{start:4105,end:4118}, lower:{start:4098,end:4110} } };
  const projection = {
    side:'BUY', entry:4112, stop:4106, target:4124,
    expires_at:'2026-09-29T05:00:00.000Z',
    target_window:{min_minutes:30,max_minutes:90}
  };
  const drawing = buildPatternDrawing({ watch, projection, candles, detectedAt:'2026-09-29T03:00:00.000Z', intervalMinutes:15, patternFamily:'CHART_PATTERN' });
  assert.equal(drawing.chartType, 'CHART_PATTERN');
  assert.equal(drawing.direction, 'BULLISH');
  assert.ok(drawing.lines.length >= 2);
  assert.ok(drawing.eventLine);
  assert.ok(drawing.arrow.length >= 1);
  assert.ok(drawing.forecast.length >= 1);
  assert.equal(drawing.predictionRectangle.length, 4);
  assert.ok(drawing.timeFrame.to > drawing.timeFrame.from);
  assert.ok(drawing.priceRange.to > drawing.priceRange.low);
});
