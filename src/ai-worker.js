import crypto from 'crypto';
import OpenAI from 'openai';
import { saveDecision, getRecentDecisions, savePlanCandidate, getRuntimeSetting } from './store.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';
import { autoActivateBestCandidate } from './plan-service.js';
import { extractMarketFeatures, prefilterSnapshot, PIPELINE_VERSIONS } from './market-features.js';

let client = null;
const inFlight = new Set();

const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    side: { type: 'string', enum: ['BUY', 'SELL'] },
    order_type: { type: 'string', enum: ['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP'] },
    setup: { type: 'string', enum: ['TREND_PULLBACK', 'BREAKOUT_RETEST', 'LIQUIDITY_SWEEP'] },
    regime: { type: 'string', enum: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'BREAKOUT', 'HIGH_VOLATILITY'] },
    entry: { type: 'number' },
    stop_loss: { type: 'number' },
    take_profit: { type: 'number' },
    expiration_candles: { type: 'integer', minimum: 1, maximum: 10 },
    decision_confidence: { type: 'number', minimum: 0, maximum: 1 },
    entry_confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason_codes: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    thesis: { type: 'string' },
    invalidation: { type: 'string' }
  },
  required: ['side','order_type','setup','regime','entry','stop_loss','take_profit','expiration_candles','decision_confidence','entry_confidence','reason_codes','thesis','invalidation']
};

const envelopeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    market_decision: { type: 'string', enum: ['WAIT', 'OFFER'] },
    decision_confidence: { type: 'number', minimum: 0, maximum: 1 },
    regime: { type: 'string', enum: ['TREND_UP','TREND_DOWN','RANGE','BREAKOUT','HIGH_VOLATILITY','CHAOTIC','NO_TRADE'] },
    reason_codes: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    thesis: { type: 'string' },
    candidate_plans: { type: 'array', maxItems: 3, items: candidateSchema }
  },
  required: ['market_decision','decision_confidence','regime','reason_codes','thesis','candidate_plans']
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
    deterministic_features: marketFeatures
  };
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
    review: { status: 'NOT_REQUIRED', source: 'PREFILTER', reasons: prefilter.reasons, reviewed_at: new Date().toISOString() },
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

function candidateDecision(candidate) {
  return {
    decision: 'PLACE_PENDING',
    side: candidate.side,
    order_type: candidate.order_type,
    setup: candidate.setup,
    regime: candidate.regime,
    entry: candidate.entry,
    stop_loss: candidate.stop_loss,
    take_profit: candidate.take_profit,
    expiration_candles: candidate.expiration_candles,
    confidence: candidate.decision_confidence,
    entry_confidence: candidate.entry_confidence,
    reason_codes: candidate.reason_codes
  };
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
    const approvalMode = String(await getRuntimeSetting('approval_mode', 'manual')).toLowerCase() === 'ai' ? 'ai' : 'manual';
    const entryThreshold = Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80);
    const openai = getClient();
    const response = await openai.responses.create({
      model,
      instructions: [
        'You are the Tradevice XAUUSD M1 candidate-plan engine in shadow research mode.',
        `Strategy version: ${PIPELINE_VERSIONS.strategy}. Prompt version: ${PIPELINE_VERSIONS.prompt}.`,
        'Use M5/M15 as context and M1 as execution timing.',
        'Return zero to three distinct structurally valid pending-order candidates. Never fabricate a candidate just to fill the list.',
        'Allowed setup families: TREND_PULLBACK, BREAKOUT_RETEST, LIQUIDITY_SWEEP.',
        'Candidates may be below the automatic approval threshold so they can still be offered for manual review.',
        `AI automatic approval threshold is entry_confidence >= ${entryThreshold.toFixed(2)}. A candidate below that threshold must never be auto-approved.`,
        'decision_confidence is confidence in the candidate thesis. entry_confidence is confidence that the proposed entry is executable with edge now.',
        'Each candidate must contain a pending order type, entry, structural stop loss, take profit, setup, regime, expiration, thesis and invalidation.',
        'Prefer plans that differ meaningfully by setup, timing or order type. Avoid duplicate price plans.',
        'If there is no structurally valid plan, return market_decision WAIT with an empty candidate_plans array.',
        'If candidate_plans is non-empty, market_decision must be OFFER.',
        'Do not choose lot size or monetary risk. Return only the structured response.'
      ].join('\n'),
      input: JSON.stringify(compactSnapshot(snapshot, marketFeatures)),
      text: { format: { type: 'json_schema', name: 'tradevice_candidate_plans', strict: true, schema: envelopeSchema } }
    });

    const parsed = JSON.parse(response.output_text);
    if (parsed.market_decision === 'WAIT' && parsed.candidate_plans.length) throw new Error('MODEL_CONTRACT_VIOLATION: WAIT_WITH_CANDIDATES');
    if (parsed.market_decision === 'OFFER' && !parsed.candidate_plans.length) throw new Error('MODEL_CONTRACT_VIOLATION: OFFER_WITHOUT_CANDIDATES');

    const groupId = `grp-${decisionKey}`;
    const savedPlans = [];
    for (let i = 0; i < parsed.candidate_plans.length; i++) {
      const candidate = parsed.candidate_plans[i];
      const decision = candidateDecision(candidate);
      const risk = validateTradeIntent(decision, snapshot);
      const preview = reviewPendingDecision(decision, risk, { manual: approvalMode === 'manual' });
      const valid = risk.approved === true && preview.status === 'APPROVED';
      const status = valid ? (approvalMode === 'manual' ? 'AWAITING_APPROVAL' : 'AI_REVIEW') : 'REJECTED';
      const plan = await savePlanCandidate({
        plan_id: `plan-${decisionKey}-${i + 1}`,
        group_id: groupId,
        symbol: snapshot.symbol || 'XAUUSD',
        market_timestamp: snapshot.timestamp,
        ...candidate,
        status,
        review: { ...preview, risk },
        source_model: model
      });
      savedPlans.push(plan);
    }

    const maxEntryConfidence = savedPlans.length ? Math.max(...savedPlans.map(p => Number(p.entry_confidence || 0))) : 0;
    const summaryTradeId = `ai-${decisionKey}`;
    await saveDecision({
      trade_id: summaryTradeId,
      mode: 'shadow',
      decision: savedPlans.length ? 'OFFER' : 'WAIT',
      regime: parsed.regime,
      confidence: parsed.decision_confidence,
      reason_codes: parsed.reason_codes,
      review: { status: 'NOT_REQUIRED', source: 'AI_CANDIDATE_ENGINE', reasons: [], reviewed_at: new Date().toISOString() },
      context: {
        ai_generated: true,
        ai_model: model,
        ai_response_id: response.id,
        decision_confidence: parsed.decision_confidence,
        entry_confidence: maxEntryConfidence,
        entry_pending_threshold: entryThreshold,
        approval_mode: approvalMode,
        candidate_group_id: groupId,
        candidate_plan_ids: savedPlans.map(p => p.plan_id),
        decision_key: decisionKey,
        market_timestamp: snapshot.timestamp,
        pipeline_versions: PIPELINE_VERSIONS,
        prefilter,
        market_features: marketFeatures,
        thesis: parsed.thesis
      }
    });

    let autoApproval = null;
    if (approvalMode === 'ai' && savedPlans.length) {
      autoApproval = await autoActivateBestCandidate(savedPlans.filter(p => p.status === 'AI_REVIEW'));
    }

    return {
      trade_id: summaryTradeId,
      decision: savedPlans.length ? 'OFFER' : 'WAIT',
      decision_confidence: parsed.decision_confidence,
      entry_confidence: maxEntryConfidence,
      approval_mode: approvalMode,
      candidates: savedPlans.map(p => ({ plan_id: p.plan_id, status: p.status, entry_confidence: Number(p.entry_confidence) })),
      auto_approval: autoApproval,
      trigger_codes: prefilter.trigger_codes,
      model
    };
  } finally {
    inFlight.delete(decisionKey);
  }
}
