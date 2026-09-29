export const KNOWLEDGE_VERSION = 'tradevice-pattern-knowledge-v1';

export const ANALYSIS_FAMILIES = Object.freeze({
  CHART_PATTERN: {
    id: 'CHART_PATTERN',
    label: 'Chart Pattern',
    description: 'Price structures defined by two or more geometric boundaries and a directional or breakout thesis.',
    quality_metrics: ['quality','clarity','initial_trend','uniformity','breakout','volume'],
    drawing_parts: ['lines','eventLine','arrow','predictionRectangle','timeFrame','priceRange']
  },
  KEY_LEVEL: {
    id: 'KEY_LEVEL',
    label: 'Key Level',
    description: 'Horizontal support or resistance structures watched for approach, rejection, breakout, and role reversal.',
    quality_metrics: ['quality','touches','distance_atr','breakout'],
    drawing_parts: ['lines','eventLine','arrow','predictionRectangle','timeFrame','priceRange']
  },
  FIBONACCI: {
    id: 'FIBONACCI',
    label: 'Fibonacci',
    description: 'Multi-swing structures evaluated from named turning points and ratio quality, with successive target levels.',
    quality_metrics: ['average_quality','ratio_quality'],
    drawing_parts: ['lines','points','arrow','predictionRectangle','timeFrame','priceRange']
  },
  CANDLE_PATTERN: {
    id: 'CANDLE_PATTERN',
    label: 'Candlestick Pattern',
    description: 'Short-horizon candle formations used as confirmation rather than a standalone order trigger.',
    quality_metrics: ['quality','context_alignment'],
    drawing_parts: ['eventLine','arrow','timeFrame','priceRange']
  }
});

export const PATTERN_CATALOG = Object.freeze({
  CHANNEL_UP: { family:'CHART_PATTERN', label:'Channel Up', geometry:'parallel_rising', default_bias:'BULLISH', trend_change:'CONTINUATION' },
  CHANNEL_DOWN: { family:'CHART_PATTERN', label:'Channel Down', geometry:'parallel_falling', default_bias:'BEARISH', trend_change:'CONTINUATION' },
  RISING_WEDGE: { family:'CHART_PATTERN', label:'Rising Wedge', geometry:'converging_rising', default_bias:'BEARISH', trend_change:'REVERSAL' },
  FALLING_WEDGE: { family:'CHART_PATTERN', label:'Falling Wedge', geometry:'converging_falling', default_bias:'BULLISH', trend_change:'REVERSAL' },
  TRIANGLE: { family:'CHART_PATTERN', label:'Triangle', geometry:'converging', default_bias:'NEUTRAL', trend_change:'BREAKOUT' },
  ASCENDING_TRIANGLE: { family:'CHART_PATTERN', label:'Ascending Triangle', geometry:'flat_resistance_rising_support', default_bias:'BULLISH', trend_change:'BREAKOUT' },
  DESCENDING_TRIANGLE: { family:'CHART_PATTERN', label:'Descending Triangle', geometry:'falling_resistance_flat_support', default_bias:'BEARISH', trend_change:'BREAKOUT' },
  HEAD_AND_SHOULDERS: { family:'CHART_PATTERN', label:'Head & Shoulders', geometry:'three_peak_neckline', default_bias:'BEARISH', trend_change:'REVERSAL' },
  INVERSE_HEAD_AND_SHOULDERS: { family:'CHART_PATTERN', label:'Inverse Head & Shoulders', geometry:'three_trough_neckline', default_bias:'BULLISH', trend_change:'REVERSAL' },
  FLAG: { family:'CHART_PATTERN', label:'Flag', geometry:'impulse_then_channel', default_bias:'CONTINUATION', trend_change:'CONTINUATION' },
  SUPPORT: { family:'KEY_LEVEL', label:'Support', geometry:'horizontal', default_bias:'BULLISH_REJECTION_OR_BEARISH_BREAK', trend_change:'CONTEXTUAL' },
  RESISTANCE: { family:'KEY_LEVEL', label:'Resistance', geometry:'horizontal', default_bias:'BEARISH_REJECTION_OR_BULLISH_BREAK', trend_change:'CONTEXTUAL' },
  SBR: { family:'KEY_LEVEL', label:'Support Becomes Resistance', geometry:'horizontal_role_reversal', default_bias:'BEARISH', trend_change:'CONTINUATION' },
  RBS: { family:'KEY_LEVEL', label:'Resistance Becomes Support', geometry:'horizontal_role_reversal', default_bias:'BULLISH', trend_change:'CONTINUATION' },
  FIBONACCI_GENERIC: { family:'FIBONACCI', label:'Fibonacci Structure', geometry:'multi_pivot_ratios', default_bias:'CONTEXTUAL', trend_change:'CONTEXTUAL' }
});

export const LIFECYCLE = Object.freeze({
  FORMING: { actionable:false, description:'Pattern geometry exists but the confirmation condition has not been reached.' },
  ARMED: { actionable:false, description:'Price is close to the trigger area and the setup is waiting for a defined confirmation.' },
  CONFIRMED: { actionable:true, description:'Trigger condition is complete and the setup may enter risk validation.' },
  INVALIDATED: { actionable:false, description:'Price action has violated the structural thesis before activation.' },
  EXPIRED: { actionable:false, description:'The setup exceeded its useful time window.' }
});

export const DRAWING_SCHEMA = Object.freeze({
  coordinates: 'unix_seconds_and_price',
  required: ['chartType','interval','direction','priceRange','timeFrame','lines'],
  optional: ['eventLine','arrow','forecast','predictionRectangle','points'],
  line_fields: ['x1','y1','x2','y2','name','point1Name','point2Name']
});

export function familyForPattern(patternType = '') {
  const key = String(patternType).toUpperCase();
  if (key.includes('SUPPORT') || key.includes('RESISTANCE') || key === 'SBR' || key === 'RBS') return ANALYSIS_FAMILIES.KEY_LEVEL;
  if (key.includes('FIB')) return ANALYSIS_FAMILIES.FIBONACCI;
  if (key.includes('CANDLE')) return ANALYSIS_FAMILIES.CANDLE_PATTERN;
  return ANALYSIS_FAMILIES.CHART_PATTERN;
}

export function catalogEntry(patternType = '') {
  const key = String(patternType).toUpperCase();
  if (PATTERN_CATALOG[key]) return PATTERN_CATALOG[key];
  if (key.includes('CHANNEL_UP')) return PATTERN_CATALOG.CHANNEL_UP;
  if (key.includes('CHANNEL_DOWN')) return PATTERN_CATALOG.CHANNEL_DOWN;
  if (key.includes('SUPPORT')) return PATTERN_CATALOG.SUPPORT;
  if (key.includes('RESISTANCE')) return PATTERN_CATALOG.RESISTANCE;
  return { family:'CHART_PATTERN', label:String(patternType || 'Structure').replaceAll('_',' '), geometry:'custom', default_bias:'CONTEXTUAL', trend_change:'CONTEXTUAL' };
}

export function qualityProfile({ quality = 0, trendStrength = 0, distanceAtr = null, status = 'FORMING' } = {}) {
  const q = Math.max(0, Math.min(1, Number(quality || 0) / (Number(quality || 0) > 1 ? 100 : 1)));
  const trend = Math.max(0, Math.min(1, Number(trendStrength || 0) / (Number(trendStrength || 0) > 1 ? 100 : 1)));
  const distance = Number.isFinite(Number(distanceAtr)) ? Number(distanceAtr) : 1;
  const proximity = Math.max(0, Math.min(1, 1 - distance / 1.5));
  const armedBonus = String(status).toUpperCase() === 'ARMED' ? 0.12 : 0;
  return {
    quality: q,
    clarity: Math.max(0, Math.min(1, q * 0.82 + proximity * 0.18)),
    initial_trend: trend,
    uniformity: Math.max(0, Math.min(1, q * 0.72 + 0.18)),
    breakout: String(status).toUpperCase() === 'CONFIRMED' ? Math.max(0.55, q) : -1,
    volume: null,
    readiness: Math.max(0, Math.min(1, q * 0.68 + proximity * 0.20 + armedBonus))
  };
}

export const KNOWLEDGE_SOURCES = Object.freeze([
  'Autochartist Technical Analysis API: public schema concepts for result families, drawing geometry, lifecycle fields and quality metrics.',
  'Tradevice implementation is independently authored and does not embed Autochartist credentials, proprietary code, or copied analysis text.'
]);
