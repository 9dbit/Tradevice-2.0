import crypto from 'crypto';
import OpenAI from 'openai';
import { saveDecision, getRecentDecisions } from './store.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';
import { extractMarketFeatures, prefilterSnapshot, PIPELINE_VERSIONS } from './market-features.js';

let client = null;
const inFlight = new Set();

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
    decision_confidence: { type: 'number', minimum: 0, maximum: 1 },
    entry_confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason_codes: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    thesis: { type: 'string' },
    invalidation: { type: 'string' }
  },
  required: [
    'decision', 'side', 'order_type', 'setup', 'regime', 'entry', 'stop_loss',
    'take_profit', 'expiration_candles', 'decision_confidence', 'entry_confidence', 'reason_codes', 'thesis', 'invalidation'
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

function compactSnapshot(snapshot, marketFeatures) {
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
    deterministic_features: marketFeatures,
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

function snapshotDecisionKey(snapshot, model) {
  const last = snapshot?.candles?.[snapshot.candles.length - 1];
  const source = JSON.stringify({
    symbol: snapshot?.symbol,
    timeframe: snapshot?.timeframe,
    snapshot_timestamp: snapshot?.timestamp,
    last_closed_bar: last?.timestamp ?? null,
    model,
    versions: PIPELINE_VERSIONS
  });
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
}

function regimeFromFeatures(features) {
  if (features.volatility === 'EXTREME') return 'HIGH_VOLATILITY';
  if (features.trend_alignment === 'UP') return 'TREND_UP';
  if (features.trend_alignment === 'DOWN') return 'TREND_DOWN';
  return 'NO_TRADE';
}

async function alreadyProcessed(decisionKey) {
  const recent = await getRecentDecisions(500);
  return recent.find(row => row?.context?.decision_key === decisionKey) ?? null;
}

async function savePrefilterWait(snapshot, model, decisionKey, prefilter) {
  const tradeId = `pf-${decisionKey}`;
  const waitDecision = {
    trade_id: tradeId,
    mode: 'shadow',
    decision: 'WAIT',
    regime: regimeFromFeatures(prefilter.features),
    confidence: 1,
    reason_codes: prefilter.reasons.map(x => `PREFILTER_${x}`).slice(0, 12),
    review: {
      status: 'NOT_REQUIRED',
      source: 'PREFILTER',
      reasons: prefilter.reasons,
      reviewed_at: new Date().toISOString()
    },
    context: {
      ai_generated: false,
      decision_confidence: 1,
      entry_confidence: 0,
      ai_model: model,
      decision_key: decisionKey,
      market_timestamp: snapshot.timestamp,
      pipeline_versions: PIPELINE_VERSIONS,
      prefilter,
      market_features: prefilter.features
    }
  };
  await saveDecision(waitDecision);
  return { skipped: 'PREFILTER_BLOCKED', trade_id: tradeId, reasons: prefilter.reasons, trigger_codes: prefilter.trigger_codes };
}

export async function runAiDecision(snapshot) {
  if (!aiWorkerEnabled()) return { skipped: 'AI_DECISION_DISABLED' };
  if (snapshot?.timeframe !== 'M1') return { skipped: 'NOT_M1' };

  const model = process.env.AI_MODEL || 'UNCONFIGURED';
  const marketFeatures = extractMarketFeatures(snapshot);
  const prefilter = prefilterSnapshot(snapshot, marketFeatures);
  const decisionKey = snapshotDecisionKey(snapshot, model);

  const existing = await alreadyProcessed(decisionKey);
  if (existing) return { skipped: 'DUPLICATE_SNAPSHOT', trade_id: existing.trade_id, decision_key: decisionKey };
  if (inFlight.has(decisionKey)) return { skipped: 'IN_FLIGHT_DUPLICATE', decision_key: decisionKey };
  if (!prefilter.should_call_ai) return savePrefilterWait(snapshot, model, decisionKey, prefilter);

  inFlight.add(decisionKey);
  try {
    const openai = getClient();
    const market = compactSnapshot(snapshot, marketFeatures);

    const response = await openai.responses.create({
      model,
      instructions: [
        'You are the Tradevice XAUUSD M1 shadow-trading decision engine.',
        `Strategy version: ${PIPELINE_VERSIONS.strategy}. Prompt version: ${PIPELINE_VERSIONS.prompt}.`,
        'This is research mode. Never assume a trade is required. WAIT is a first-class decision.',
        'Use M5 and M15 only as context; M1 is the execution timeframe.',
        'Only use TREND_PULLBACK, BREAKOUT_RETEST, or LIQUIDITY_SWEEP.',
        'Prefer pending orders. Do not choose lot size or monetary risk.',
        `decision_confidence means confidence that the chosen decision itself is correct. entry_confidence means confidence that a currently executable pending-entry setup has edge.`,
        `If entry_confidence is at least ${Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80).toFixed(2)}, you MUST choose PLACE_PENDING and provide a complete structurally valid order.`,
        `Never return WAIT with entry_confidence at or above ${Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80).toFixed(2)}. WAIT may still have high decision_confidence when the model is highly confident that no trade should be placed.`,
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
    const entryThreshold = Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80);
    if (parsed.decision === 'WAIT' && parsed.entry_confidence >= entryThreshold) {
      throw new Error(`MODEL_CONTRACT_VIOLATION: WAIT_WITH_ENTRY_CONFIDENCE_${parsed.entry_confidence}`);
    }
    if (parsed.decision === 'PLACE_PENDING' && parsed.entry_confidence < entryThreshold) {
      throw new Error(`MODEL_CONTRACT_VIOLATION: PENDING_BELOW_ENTRY_THRESHOLD_${parsed.entry_confidence}`);
    }
    const baseDecision = stripNulls({
      ...parsed,
      confidence: parsed.decision_confidence
    });
    const tradeId = `ai-${decisionKey}`;
    const risk = validateTradeIntent(baseDecision, snapshot);
    const review = reviewPendingDecision(baseDecision, risk);

    const decision = {
      ...baseDecision,
      trade_id: tradeId,
      mode: 'shadow',
      review,
      context: {
        ai_generated: true,
        ai_model: model,
        ai_response_id: response.id,
        decision_confidence: parsed.decision_confidence,
        entry_confidence: parsed.entry_confidence,
        entry_pending_threshold: entryThreshold,
        decision_key: decisionKey,
        market_timestamp: snapshot.timestamp,
        pipeline_versions: PIPELINE_VERSIONS,
        prefilter,
        market_features: marketFeatures,
        thesis: parsed.thesis,
        invalidation: parsed.invalidation,
        risk_review: risk,
        review_agent: review
      }
    };

    delete decision.thesis;
    delete decision.invalidation;
    delete decision.decision_confidence;
    delete decision.entry_confidence;
    await saveDecision(decision);

    return {
      trade_id: tradeId,
      decision: decision.decision,
      decision_confidence: parsed.decision_confidence,
      entry_confidence: parsed.entry_confidence,
      decision_key: decisionKey,
      risk_approved: risk.approved,
      risk_reasons: risk.reasons,
      review_status: review.status,
      review_reasons: review.reasons,
      trigger_codes: prefilter.trigger_codes,
      pipeline_versions: PIPELINE_VERSIONS,
      model
    };
  } finally {
    inFlight.delete(decisionKey);
  }
}
