import OpenAI from 'openai';
import { saveDecision } from './store.js';
import { validateTradeIntent } from './risk.js';

let client = null;

const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['WAIT', 'PLACE_PENDING', 'CANCEL'] },
    side: { anyOf: [{ type: 'string', enum: ['BUY', 'SELL'] }, { type: 'null' }] },
    order_type: { anyOf: [{ type: 'string', enum: ['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP'] }, { type: 'null' }] },
    setup: { anyOf: [{ type: 'string', enum: ['TREND_PULLBACK', 'BREAKOUT_RETEST', 'LIQUIDITY_SWEEP'] }, { type: 'null' }] },
    regime: { type: 'string', enum: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'BREAKOUT', 'HIGH_VOLATILITY', 'CHAOTIC', 'NO_TRADE'] },
    entry: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    stop_loss: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    take_profit: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    expiration_candles: { anyOf: [{ type: 'integer', minimum: 1, maximum: 10 }, { type: 'null' }] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason_codes: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    thesis: { type: 'string' },
    invalidation: { type: 'string' }
  },
  required: [
    'decision', 'side', 'order_type', 'setup', 'regime', 'entry', 'stop_loss',
    'take_profit', 'expiration_candles', 'confidence', 'reason_codes', 'thesis', 'invalidation'
  ]
};

export function aiWorkerEnabled() {
  return String(process.env.AI_DECISION_ENABLED || 'false').toLowerCase() === 'true';
}

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function compactSnapshot(snapshot) {
  return {
    symbol: snapshot.symbol,
    timeframe: snapshot.timeframe,
    timestamp: snapshot.timestamp,
    bid: snapshot.bid,
    ask: snapshot.ask,
    spread_points: snapshot.spread_points,
    m1_candles: snapshot.candles,
    m5_candles: snapshot.features?.m5_candles ?? [],
    m15_candles: snapshot.features?.m15_candles ?? [],
    point_size: snapshot.features?.point_size ?? null,
    account: {
      balance: snapshot.account?.balance ?? null,
      equity: snapshot.account?.equity ?? null,
      margin_free: snapshot.account?.margin_free ?? null
    }
  };
}

function stripNulls(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null));
}

export async function runAiDecision(snapshot) {
  if (!aiWorkerEnabled()) return { skipped: 'AI_DECISION_DISABLED' };
  if (snapshot?.timeframe !== 'M1') return { skipped: 'NOT_M1' };

  const model = process.env.AI_MODEL || 'gpt-6-astra';
  const openai = getClient();
  const market = compactSnapshot(snapshot);

  const response = await openai.responses.create({
    model,
    instructions: [
      'You are the Tradevice XAUUSD M1 shadow-trading decision engine.',
      'This is research mode. Never assume a trade is required. WAIT is a first-class decision.',
      'Use M5 and M15 only as context; M1 is the execution timeframe.',
      'Only use TREND_PULLBACK, BREAKOUT_RETEST, or LIQUIDITY_SWEEP.',
      'Prefer pending orders. Do not choose lot size or monetary risk.',
      'For PLACE_PENDING, entry, stop_loss, take_profit, side, order_type, setup and expiration_candles must be non-null.',
      'For WAIT, use null for fields that do not apply.',
      'Stop loss must represent structural invalidation, not an arbitrary fixed distance.',
      'Avoid a setup when spread, structure, volatility, or reward/risk makes the edge unclear.',
      'Return only the structured decision.'
    ].join('\n'),
    input: JSON.stringify(market),
    text: {
      format: {
        type: 'json_schema',
        name: 'tradevice_shadow_decision',
        strict: true,
        schema: decisionSchema
      }
    }
  });

  const parsed = JSON.parse(response.output_text);
  const baseDecision = stripNulls(parsed);
  const tradeId = `ai-${String(snapshot.timestamp).replace(/[^0-9A-Za-z]/g, '')}-${response.id.slice(-8)}`;
  const risk = validateTradeIntent(baseDecision, snapshot);

  const decision = {
    ...baseDecision,
    trade_id: tradeId,
    mode: 'shadow',
    context: {
      ai_generated: true,
      ai_model: model,
      ai_response_id: response.id,
      market_timestamp: snapshot.timestamp,
      thesis: parsed.thesis,
      invalidation: parsed.invalidation,
      risk_review: risk
    }
  };

  delete decision.thesis;
  delete decision.invalidation;
  await saveDecision(decision);

  return {
    trade_id: tradeId,
    decision: decision.decision,
    risk_approved: risk.approved,
    risk_reasons: risk.reasons,
    model
  };
}
