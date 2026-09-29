import { getLatestSnapshot, getPlanCandidate, saveDecision, updatePlanCandidateStatus, supersedePlanGroup } from './store.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';

function toDecision(plan) {
  return {
    decision: 'PLACE_PENDING',
    side: plan.side,
    order_type: plan.order_type,
    setup: plan.setup,
    regime: plan.regime,
    entry: Number(plan.entry),
    stop_loss: Number(plan.stop_loss),
    take_profit: Number(plan.take_profit),
    expiration_candles: Number(plan.expiration_candles || 3),
    confidence: Number(plan.decision_confidence ?? plan.entry_confidence),
    entry_confidence: Number(plan.entry_confidence),
    reason_codes: Array.isArray(plan.reason_codes) ? plan.reason_codes : []
  };
}

export async function activatePlanCandidate(planId, source = 'MANUAL') {
  const plan = await getPlanCandidate(planId);
  if (!plan) return { ok: false, code: 'PLAN_NOT_FOUND' };
  if (!['CANDIDATE','AWAITING_APPROVAL','AI_REVIEW'].includes(plan.status)) {
    return { ok: false, code: 'PLAN_NOT_ACTIVATABLE', status: plan.status };
  }

  const snapshot = await getLatestSnapshot(plan.symbol || 'XAUUSD');
  if (!snapshot) return { ok: false, code: 'NO_MARKET_SNAPSHOT' };

  const decision = toDecision(plan);
  const risk = validateTradeIntent(decision, snapshot);
  const review = reviewPendingDecision(decision, risk, { manual: source === 'MANUAL' });
  if (!review || review.status !== 'APPROVED') {
    const rejected = await updatePlanCandidateStatus(planId, 'REJECTED', {
      review: { ...review, source: source === 'MANUAL' ? 'MANUAL_REVIEW' : 'AUTO_REVIEW', risk }
    });
    return { ok: false, code: 'PLAN_REJECTED', risk, review, plan: rejected };
  }

  const deterministic = String(plan.source_model || '').startsWith('deterministic-');
  const tradeId = `plan-${plan.plan_id}`;
  await saveDecision({
    ...decision,
    trade_id: tradeId,
    mode: 'shadow',
    review,
    context: {
      candidate_plan_id: plan.plan_id,
      candidate_group_id: plan.group_id,
      approval_source: source,
      decision_confidence: Number(plan.decision_confidence ?? plan.entry_confidence),
      entry_confidence: Number(plan.entry_confidence),
      entry_pending_threshold: Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80),
      market_timestamp: plan.market_timestamp,
      thesis: plan.thesis,
      invalidation: plan.invalidation,
      risk_review: risk,
      review_agent: review,
      source_model: plan.source_model || null,
      ai_model: deterministic ? null : (plan.source_model || null),
      ai_generated: !deterministic,
      deterministic_engine: deterministic,
      engine_version: deterministic ? plan.source_model : null,
      setup_score: Number(plan.review?.setup_score ?? plan.entry_confidence * 100),
      score_components: plan.review?.score_components ?? null,
      strategy_state: plan.review?.strategy_state ?? null,
      strategy_fingerprint: plan.review?.fingerprint ?? null,
      zone: plan.review?.zone ?? null,
      reward_risk: Number(plan.review?.reward_risk ?? risk?.metrics?.reward_risk ?? 0)
    }
  });

  const approvedStatus = source === 'MANUAL' ? 'MANUAL_APPROVED' : 'AUTO_APPROVED';
  const approved = await updatePlanCandidateStatus(planId, approvedStatus, {
    review: { ...review, source: source === 'MANUAL' ? 'MANUAL_USER' : 'AUTO_ENGINE', risk },
    linked_trade_id: tradeId,
    approved_at: new Date().toISOString()
  });
  await supersedePlanGroup(plan.group_id, plan.plan_id);
  return { ok: true, trade_id: tradeId, plan: approved, risk, review };
}

export async function rejectPlanCandidate(planId, source = 'MANUAL') {
  const plan = await getPlanCandidate(planId);
  if (!plan) return { ok: false, code: 'PLAN_NOT_FOUND' };
  if (!['CANDIDATE','AWAITING_APPROVAL','AI_REVIEW'].includes(plan.status)) {
    return { ok: false, code: 'PLAN_NOT_REJECTABLE', status: plan.status };
  }
  const rejected = await updatePlanCandidateStatus(planId, 'REJECTED', {
    review: { status: 'REJECTED', source: source === 'MANUAL' ? 'MANUAL_USER' : 'AUTO_ENGINE', reasons: ['USER_REJECTED'] },
    rejected_at: new Date().toISOString()
  });
  return { ok: true, plan: rejected };
}

export async function autoActivateBestCandidate(plans = []) {
  const threshold = Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80);
  const eligible = [...plans]
    .filter(plan => Number(plan.entry_confidence) >= threshold)
    .sort((a,b) => Number(b.entry_confidence) - Number(a.entry_confidence));
  const attempts = [];
  for (const plan of eligible) {
    const result = await activatePlanCandidate(plan.plan_id, 'AI');
    attempts.push({ plan_id: plan.plan_id, ok: result.ok, code: result.code ?? null });
    if (result.ok) return { approved: result, attempts };
  }
  return { approved: null, attempts };
}
