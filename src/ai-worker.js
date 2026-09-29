import {
  saveDecision,
  savePlanCandidate,
  getPlanCandidate,
  getRuntimeSetting,
  setRuntimeSetting
} from './store.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';
import { autoActivateBestCandidate } from './plan-service.js';
import { detectSbrRbsSetup } from './structure-engine.js';

const ENGINE_VERSION = 'deterministic-sbr-rbs-v1';

export function aiWorkerEnabled() {
  return String(process.env.STRUCTURE_ENGINE_ENABLED || 'true').toLowerCase() !== 'false';
}

function asDecision(candidate) {
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
  if (!aiWorkerEnabled()) return { skipped: 'STRUCTURE_ENGINE_DISABLED' };
  if (snapshot?.timeframe !== 'M1') return { skipped: 'NOT_M1' };

  const scan = detectSbrRbsSetup(snapshot);
  await setRuntimeSetting('structure_engine_state', {
    engine: ENGINE_VERSION,
    state: scan.state,
    scanned_at: scan.scanned_at ?? snapshot.timestamp,
    atr_m5: scan.atr_m5 ?? null,
    zones: scan.zones ?? null,
    candidate: scan.candidate ? {
      fingerprint: scan.candidate.fingerprint,
      setup: scan.candidate.setup,
      side: scan.candidate.side,
      setup_score: scan.candidate.setup_score,
      rr: scan.candidate.rr,
      zone: scan.candidate.zone,
      break_candle_timestamp: scan.candidate.break_candle_timestamp
    } : null
  });

  if (!scan.candidate) {
    return {
      skipped: 'NO_STRUCTURE_EVENT',
      engine: ENGINE_VERSION,
      state: scan.state,
      zones: scan.zones ?? null
    };
  }

  const candidate = scan.candidate;
  const planId = `structure-${candidate.fingerprint}`;
  const existing = await getPlanCandidate(planId);
  if (existing) {
    return {
      skipped: 'DUPLICATE_STRUCTURE_EVENT',
      engine: ENGINE_VERSION,
      fingerprint: candidate.fingerprint,
      plan_id: planId,
      status: existing.status
    };
  }

  const approvalMode = String(await getRuntimeSetting('approval_mode', 'manual')).toLowerCase() === 'ai' ? 'ai' : 'manual';
  const decision = asDecision(candidate);
  const risk = validateTradeIntent(decision, snapshot);
  const review = reviewPendingDecision(decision, risk, { manual: approvalMode === 'manual' });
  const valid = risk.approved === true && review?.status === 'APPROVED';
  const status = valid
    ? (approvalMode === 'manual' ? 'AWAITING_APPROVAL' : 'AI_REVIEW')
    : 'REJECTED';

  const groupId = `structure-${candidate.fingerprint}`;
  const plan = await savePlanCandidate({
    plan_id: planId,
    group_id: groupId,
    symbol: snapshot.symbol || 'XAUUSD',
    market_timestamp: snapshot.timestamp,
    side: candidate.side,
    order_type: candidate.order_type,
    setup: candidate.setup,
    regime: candidate.regime,
    entry: candidate.entry,
    stop_loss: candidate.stop_loss,
    take_profit: candidate.take_profit,
    expiration_candles: candidate.expiration_candles,
    decision_confidence: candidate.decision_confidence,
    entry_confidence: candidate.entry_confidence,
    reason_codes: candidate.reason_codes,
    thesis: candidate.thesis,
    invalidation: candidate.invalidation,
    status,
    review: {
      ...review,
      source: 'DETERMINISTIC_STRUCTURE_ENGINE',
      risk,
      setup_score: candidate.setup_score,
      score_components: candidate.score_components,
      strategy_state: candidate.state,
      fingerprint: candidate.fingerprint,
      zone: candidate.zone,
      reward_risk: candidate.rr
    },
    source_model: ENGINE_VERSION
  });

  await saveDecision({
    trade_id: `structure-event-${candidate.fingerprint}`,
    mode: 'shadow',
    decision: valid ? 'OFFER' : 'WAIT',
    regime: candidate.regime,
    confidence: candidate.decision_confidence,
    reason_codes: candidate.reason_codes,
    review: {
      status: 'NOT_REQUIRED',
      source: 'DETERMINISTIC_STRUCTURE_ENGINE',
      reasons: valid ? [] : (risk.reasons || []),
      reviewed_at: new Date().toISOString()
    },
    context: {
      ai_generated: false,
      deterministic_engine: true,
      engine_version: ENGINE_VERSION,
      strategy_fingerprint: candidate.fingerprint,
      setup: candidate.setup,
      setup_score: candidate.setup_score,
      score_components: candidate.score_components,
      strategy_state: candidate.state,
      zone: candidate.zone,
      reward_risk: candidate.rr,
      decision_confidence: candidate.decision_confidence,
      entry_confidence: candidate.entry_confidence,
      market_timestamp: snapshot.timestamp,
      thesis: candidate.thesis,
      invalidation: candidate.invalidation,
      astra_called: false
    }
  });

  let autoApproval = null;
  if (approvalMode === 'ai' && valid) {
    autoApproval = await autoActivateBestCandidate([plan]);
  }

  return {
    engine: ENGINE_VERSION,
    astra_called: false,
    event: candidate.state,
    fingerprint: candidate.fingerprint,
    setup_score: candidate.setup_score,
    plan_id: plan.plan_id,
    plan_status: plan.status,
    auto_approval: autoApproval
  };
}
