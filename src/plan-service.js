import { getLatestSnapshot, getPlanCandidate, saveDecision, updatePlanCandidateStatus, supersedePlanGroup } from './store.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';

const ACTIVE_PLAN_STATUSES = new Set(['CANDIDATE','AWAITING_APPROVAL','AI_REVIEW']);

function timeframeMinutes(timeframe) {
  const tf = String(timeframe || '').toUpperCase();
  if (tf === 'M15') return 15;
  if (tf === 'M5') return 5;
  if (tf === 'H1') return 60;
  return 1;
}

export function planExpiryInfo(plan, now = Date.now()) {
  const base = Date.parse(plan?.market_timestamp || plan?.created_at || '');
  const deterministic = String(plan?.source_model || '').startsWith('deterministic-');
  const expirationTimeframe = plan?.review?.expiration_timeframe || (deterministic ? 'M5' : 'M1');
  const candleMinutes = timeframeMinutes(expirationTimeframe);
  const candles = Math.max(1, Number(plan?.expiration_candles || 3));
  const ttlMs = candles * candleMinutes * 60_000 + 30_000;
  const ageMs = Number.isFinite(base) ? Math.max(0, Number(now) - base) : Infinity;
  return { expired: ageMs > ttlMs, age_ms: ageMs, ttl_ms: ttlMs, candle_minutes: candleMinutes, timeframe: expirationTimeframe };
}

function toDecision(plan) {
  return {
    decision: 'PLACE_PENDING', side: plan.side, order_type: plan.order_type, setup: plan.setup, regime: plan.regime,
    entry: Number(plan.entry), stop_loss: Number(plan.stop_loss), take_profit: Number(plan.take_profit),
    expiration_candles: Number(plan.expiration_candles || 3), confidence: Number(plan.decision_confidence ?? plan.entry_confidence),
    entry_confidence: Number(plan.entry_confidence), reason_codes: Array.isArray(plan.reason_codes) ? plan.reason_codes : []
  };
}

function latestClose(snapshot, timeframe) {
  const tf = String(timeframe || '').toUpperCase();
  const bars = tf === 'M15' ? snapshot?.features?.m15_candles : tf === 'M5' ? snapshot?.features?.m5_candles : snapshot?.candles;
  if (!Array.isArray(bars) || !bars.length) return null;
  const close = Number(bars[bars.length - 1]?.close);
  return Number.isFinite(close) ? close : null;
}

function structuralInvalidation(plan, snapshot) {
  const rule = plan?.review?.pre_fill_invalidation;
  if (!rule || !Number.isFinite(Number(rule.level))) return null;
  const close = latestClose(snapshot, rule.timeframe || plan?.review?.timeframe || 'M5');
  if (close === null) return null;
  const level = Number(rule.level);
  if (rule.operator === 'BELOW' && close < level) return { code:'STRUCTURE_CLOSED_BELOW_INVALIDATION', close, level, timeframe:rule.timeframe };
  if (rule.operator === 'ABOVE' && close > level) return { code:'STRUCTURE_CLOSED_ABOVE_INVALIDATION', close, level, timeframe:rule.timeframe };
  return null;
}

export async function activatePlanCandidate(planId, source = 'MANUAL') {
  const plan = await getPlanCandidate(planId);
  if (!plan) return { ok: false, code: 'PLAN_NOT_FOUND' };
  if (!ACTIVE_PLAN_STATUSES.has(plan.status)) return { ok: false, code: 'PLAN_NOT_ACTIVATABLE', status: plan.status };

  const expiry = planExpiryInfo(plan);
  if (expiry.expired) {
    const expired = await updatePlanCandidateStatus(planId, 'EXPIRED', {
      review: { ...(plan.review ?? {}), status: 'EXPIRED', source: 'LIFECYCLE_ENGINE', reasons: ['TTL_EXPIRED'], expiry }
    });
    return { ok: false, code: 'PLAN_EXPIRED', expiry, plan: expired };
  }

  const snapshot = await getLatestSnapshot(plan.symbol || 'XAUUSD');
  if (!snapshot) return { ok: false, code: 'NO_MARKET_SNAPSHOT' };

  const structureFailure = structuralInvalidation(plan, snapshot);
  if (structureFailure) {
    const invalidated = await updatePlanCandidateStatus(planId, 'INVALIDATED', {
      review: { ...(plan.review ?? {}), status:'INVALIDATED', source:'STRUCTURE_RECHECK', reasons:[structureFailure.code], structure_recheck:structureFailure }
    });
    return { ok:false, code:'PLAN_INVALIDATED', structure:structureFailure, plan:invalidated };
  }

  const decision = toDecision(plan);
  const risk = validateTradeIntent(decision, snapshot);
  const review = reviewPendingDecision(decision, risk, { manual: source === 'MANUAL' });
  if (!review || review.status !== 'APPROVED') {
    const invalidated = await updatePlanCandidateStatus(planId, 'INVALIDATED', {
      review: {
        ...(plan.review ?? {}), ...review, status:'INVALIDATED', source:source === 'MANUAL' ? 'MANUAL_RECHECK' : 'AUTO_RECHECK',
        reasons:Array.isArray(review?.reasons)&&review.reasons.length?review.reasons:['RISK_RECHECK_FAILED'], risk
      }
    });
    return { ok:false, code:'PLAN_INVALIDATED', risk, review, plan:invalidated };
  }

  const deterministic = String(plan.source_model || '').startsWith('deterministic-');
  const expirationTimeframe = plan?.review?.expiration_timeframe || (deterministic ? 'M5' : 'M1');
  const tradeId = `plan-${plan.plan_id}`;
  await saveDecision({
    ...decision, trade_id:tradeId, mode:'shadow', review,
    context: {
      candidate_plan_id:plan.plan_id, candidate_group_id:plan.group_id, approval_source:source,
      decision_confidence:Number(plan.decision_confidence ?? plan.entry_confidence), entry_confidence:Number(plan.entry_confidence),
      entry_pending_threshold:Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80), market_timestamp:plan.market_timestamp,
      thesis:plan.thesis, invalidation:plan.invalidation, risk_review:risk, review_agent:review,
      source_model:plan.source_model || null, ai_model:deterministic ? null : (plan.source_model || null), ai_generated:!deterministic,
      deterministic_engine:deterministic, engine_version:deterministic ? plan.source_model : null,
      setup_score:Number(plan.review?.setup_score ?? plan.entry_confidence * 100), score_components:plan.review?.score_components ?? null,
      strategy_state:plan.review?.strategy_state ?? null, strategy_fingerprint:plan.review?.fingerprint ?? null,
      zone:plan.review?.zone ?? null, reward_risk:Number(plan.review?.reward_risk ?? risk?.metrics?.reward_risk ?? 0),
      expiration_timeframe:expirationTimeframe, expires_at:plan.review?.expires_at ?? null,
      estimated_target_window:plan.review?.estimated_target_window ?? null, pattern:plan.review?.pattern ?? null,
      confluence:plan.review?.confluence ?? [], pre_fill_invalidation:plan.review?.pre_fill_invalidation ?? null,
      visual:plan.review?.visual ?? null
    }
  });

  const approvedStatus = source === 'MANUAL' ? 'MANUAL_APPROVED' : 'AUTO_APPROVED';
  const approved = await updatePlanCandidateStatus(planId, approvedStatus, {
    review: { ...(plan.review ?? {}), ...review, status:'APPROVED', source:source === 'MANUAL' ? 'MANUAL_USER' : 'AUTO_ENGINE', risk },
    linked_trade_id:tradeId, approved_at:new Date().toISOString()
  });
  await supersedePlanGroup(plan.group_id, plan.plan_id);
  return { ok:true, trade_id:tradeId, plan:approved, risk, review };
}

export async function rejectPlanCandidate(planId, source = 'MANUAL') {
  const plan = await getPlanCandidate(planId);
  if (!plan) return { ok:false, code:'PLAN_NOT_FOUND' };
  if (!ACTIVE_PLAN_STATUSES.has(plan.status)) return { ok:false, code:'PLAN_NOT_REJECTABLE', status:plan.status };
  const rejected = await updatePlanCandidateStatus(planId, 'REJECTED', {
    review:{ ...(plan.review ?? {}), status:'REJECTED', source:source === 'MANUAL' ? 'MANUAL_USER' : 'AUTO_ENGINE', reasons:['USER_REJECTED'] },
    rejected_at:new Date().toISOString()
  });
  return { ok:true, plan:rejected };
}

export async function autoActivateBestCandidate(plans = []) {
  const threshold = Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80);
  const eligible = [...plans].filter(plan=>Number(plan.entry_confidence)>=threshold).sort((a,b)=>Number(b.entry_confidence)-Number(a.entry_confidence));
  const attempts=[];
  for (const plan of eligible) {
    const result=await activatePlanCandidate(plan.plan_id,'AI');
    attempts.push({plan_id:plan.plan_id,ok:result.ok,code:result.code??null});
    if(result.ok) return {approved:result,attempts};
  }
  return {approved:null,attempts};
}
