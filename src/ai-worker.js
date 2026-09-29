import {
  saveDecision,
  savePlanCandidate,
  getPlanCandidate,
  getRuntimeSetting,
  setRuntimeSetting,
  listPlanCandidates,
  updatePlanCandidateStatus
} from './store.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';
import { autoActivateBestCandidate, planExpiryInfo } from './plan-service.js';
import { detectSbrRbsSetup } from './structure-engine.js';
import { detectChannelTrendlinePatterns } from './pattern-engine.js';

const ENGINE_VERSION = 'deterministic-pattern-suite-v1';
const SBR_ENGINE = 'deterministic-sbr-rbs-v1';
const ACTIVE_PLAN_STATUSES = new Set(['CANDIDATE','AWAITING_APPROVAL','AI_REVIEW']);

export function aiWorkerEnabled() {
  return String(process.env.STRUCTURE_ENGINE_ENABLED || 'true').toLowerCase() !== 'false';
}

function asDecision(candidate) {
  return {
    decision: 'PLACE_PENDING', side: candidate.side, order_type: candidate.order_type,
    setup: candidate.setup, regime: candidate.regime, entry: candidate.entry,
    stop_loss: candidate.stop_loss, take_profit: candidate.take_profit,
    expiration_candles: candidate.expiration_candles,
    confidence: candidate.decision_confidence, entry_confidence: candidate.entry_confidence,
    reason_codes: candidate.reason_codes
  };
}

async function expireStalePlans(nowMs) {
  const plans = await listPlanCandidates(100);
  const expired = [];
  for (const plan of plans) {
    if (!ACTIVE_PLAN_STATUSES.has(plan.status)) continue;
    const info = planExpiryInfo(plan, nowMs);
    if (!info.expired) continue;
    await updatePlanCandidateStatus(plan.plan_id, 'EXPIRED', {
      review: { ...(plan.review ?? {}), status: 'EXPIRED', source: 'LIFECYCLE_ENGINE', reasons: ['TTL_EXPIRED'], expiry: info }
    });
    expired.push(plan.plan_id);
  }
  return expired;
}

function withDefaults(candidate, snapshot, sbrAtr = null) {
  const timeframe = candidate.expiration_timeframe || candidate.timeframe || 'M5';
  const timeframeMinutes = timeframe === 'M15' ? 15 : timeframe === 'M5' ? 5 : 1;
  const base = Date.parse(candidate.break_candle_timestamp || snapshot.timestamp || '');
  const expiresAt = candidate.expires_at || (Number.isFinite(base)
    ? new Date(base + Math.max(1, Number(candidate.expiration_candles || 3)) * timeframeMinutes * 60_000).toISOString()
    : null);
  return {
    ...candidate,
    engine_version: candidate.engine_version || SBR_ENGINE,
    expiration_timeframe: timeframe,
    expires_at: expiresAt,
    atr_reference: Number(candidate.atr_reference || sbrAtr || 0) || null,
    pattern_status: candidate.pattern_status || 'CONFIRMED',
    pattern_name: candidate.pattern_name || candidate.setup,
    timeframe: candidate.timeframe || timeframe,
    confluence: Array.isArray(candidate.confluence) ? candidate.confluence : []
  };
}

function mergeConfluence(candidates) {
  const sorted = [...candidates].sort((a,b) => Number(b.setup_score||0)-Number(a.setup_score||0));
  const out = [];
  for (const candidate of sorted) {
    const risk = Math.abs(Number(candidate.entry)-Number(candidate.stop_loss));
    const atr = Number(candidate.atr_reference || 0);
    const tolerance = Math.max(0.15, atr > 0 ? atr * 0.28 : risk * 0.45);
    const match = out.find(x => x.side === candidate.side && Math.abs(Number(x.entry)-Number(candidate.entry)) <= tolerance);
    if (!match) {
      out.push({...candidate, confluence:[...(candidate.confluence||[])]});
      continue;
    }
    const evidence = candidate.pattern_name || candidate.setup;
    if (!match.confluence.includes(evidence)) match.confluence.push(evidence);
    match.setup_score = Math.min(100, Number(match.setup_score||0) + 4);
    match.entry_confidence = match.setup_score / 100;
    match.decision_confidence = match.setup_score / 100;
    match.reason_codes = [...new Set([...(match.reason_codes||[]), `CONFLUENCE_${String(evidence).replaceAll(' ','_')}`])];
    match.thesis = `${match.thesis} Confluence: ${evidence.replaceAll('_',' ')} confirms a nearby ${match.side.toLowerCase()} structure.`;
  }
  return out.sort((a,b)=>Number(b.setup_score||0)-Number(a.setup_score||0)||Number(b.rr||0)-Number(a.rr||0)).slice(0,5);
}

async function persistCandidate(candidate, snapshot, approvalMode) {
  const planId = `structure-${candidate.fingerprint}`;
  const existing = await getPlanCandidate(planId);
  if (existing) return { plan: existing, created: false, valid: ACTIVE_PLAN_STATUSES.has(existing.status) };

  const decision = asDecision(candidate);
  const risk = validateTradeIntent(decision, snapshot);
  const review = reviewPendingDecision(decision, risk, { manual: approvalMode === 'manual' });
  const valid = risk.approved === true && review?.status === 'APPROVED';
  const status = valid ? (approvalMode === 'manual' ? 'AWAITING_APPROVAL' : 'AI_REVIEW') : 'INVALIDATED';
  const groupId = `pattern-${snapshot.timestamp || 'market'}`;
  const pattern = candidate.pattern || {
    name: candidate.pattern_name, status: candidate.pattern_status, timeframe: candidate.timeframe,
    detected_at: candidate.break_candle_timestamp || snapshot.timestamp,
    target_window: candidate.estimated_target_window || null, expires_at: candidate.expires_at || null
  };

  const plan = await savePlanCandidate({
    plan_id: planId, group_id: groupId, symbol: snapshot.symbol || 'XAUUSD', market_timestamp: snapshot.timestamp,
    side: candidate.side, order_type: candidate.order_type, setup: candidate.setup, regime: candidate.regime,
    entry: candidate.entry, stop_loss: candidate.stop_loss, take_profit: candidate.take_profit,
    expiration_candles: candidate.expiration_candles, decision_confidence: candidate.decision_confidence,
    entry_confidence: candidate.entry_confidence, reason_codes: candidate.reason_codes,
    thesis: candidate.thesis, invalidation: candidate.invalidation, status,
    review: {
      ...review, status: valid ? review.status : 'INVALIDATED', source: 'DETERMINISTIC_PATTERN_ENGINE', risk,
      setup_score: candidate.setup_score, score_components: candidate.score_components,
      strategy_state: candidate.state, fingerprint: candidate.fingerprint, zone: candidate.zone ?? null,
      reward_risk: candidate.rr, engine_version: candidate.engine_version,
      pattern, pattern_status: candidate.pattern_status, timeframe: candidate.timeframe,
      expiration_timeframe: candidate.expiration_timeframe, expires_at: candidate.expires_at,
      estimated_target_window: candidate.estimated_target_window || null,
      confluence: candidate.confluence || [], visual: candidate.visual || null,
      pre_fill_invalidation: candidate.pre_fill_invalidation || null
    },
    source_model: candidate.engine_version
  });

  await saveDecision({
    trade_id: `structure-event-${candidate.fingerprint}`, mode: 'shadow', decision: valid ? 'OFFER' : 'WAIT',
    regime: candidate.regime, confidence: candidate.decision_confidence, reason_codes: candidate.reason_codes,
    review: { status: 'NOT_REQUIRED', source: 'DETERMINISTIC_PATTERN_ENGINE', reasons: valid ? [] : (risk.reasons || []), reviewed_at: new Date().toISOString() },
    context: {
      ai_generated: false, astra_called: false, deterministic_engine: true, engine_version: candidate.engine_version,
      strategy_fingerprint: candidate.fingerprint, setup: candidate.setup, setup_score: candidate.setup_score,
      score_components: candidate.score_components, strategy_state: candidate.state, zone: candidate.zone ?? null,
      reward_risk: candidate.rr, decision_confidence: candidate.decision_confidence,
      entry_confidence: candidate.entry_confidence, market_timestamp: snapshot.timestamp,
      thesis: candidate.thesis, invalidation: candidate.invalidation,
      expiration_timeframe: candidate.expiration_timeframe, expires_at: candidate.expires_at,
      estimated_target_window: candidate.estimated_target_window || null, pattern,
      confluence: candidate.confluence || [], pre_fill_invalidation: candidate.pre_fill_invalidation || null
    }
  });
  return {plan, created:true, valid};
}

export async function runAiDecision(snapshot) {
  if (!aiWorkerEnabled()) return { skipped: 'STRUCTURE_ENGINE_DISABLED' };
  if (snapshot?.timeframe !== 'M1') return { skipped: 'NOT_M1' };

  const nowMs = Number.isFinite(Date.parse(snapshot.timestamp)) ? Date.parse(snapshot.timestamp) : Date.now();
  const expiredPlans = await expireStalePlans(nowMs);
  const sbrScan = detectSbrRbsSetup(snapshot);
  const patternScan = detectChannelTrendlinePatterns(snapshot);
  const raw = [];
  if (sbrScan.candidate) raw.push(withDefaults(sbrScan.candidate, snapshot, sbrScan.atr_m5));
  for (const candidate of patternScan.candidates || []) raw.push(withDefaults(candidate, snapshot, sbrScan.atr_m5));
  const candidates = mergeConfluence(raw);

  await setRuntimeSetting('structure_engine_state', {
    engine: ENGINE_VERSION, state: candidates.length ? 'CONFIRMED' : (patternScan.state === 'FORMING' ? 'FORMING' : sbrScan.state),
    scanned_at: snapshot.timestamp, atr_m5: sbrScan.atr_m5 ?? null, atr_m15: patternScan.atr_m15 ?? null,
    zones: sbrScan.zones ?? null, watches: patternScan.watches || [], expired_plans: expiredPlans,
    candidates: candidates.map(c => ({fingerprint:c.fingerprint,setup:c.setup,pattern_name:c.pattern_name,side:c.side,setup_score:c.setup_score,rr:c.rr,timeframe:c.timeframe,confluence:c.confluence||[]}))
  });

  if (!candidates.length) {
    return { skipped:'NO_STRUCTURE_EVENT', engine:ENGINE_VERSION, astra_called:false, state:patternScan.state || sbrScan.state, expired_plans:expiredPlans.length, watches:(patternScan.watches||[]).length, zones:sbrScan.zones??null };
  }

  const approvalMode = String(await getRuntimeSetting('approval_mode', 'manual')).toLowerCase() === 'ai' ? 'ai' : 'manual';
  const persisted=[];
  for (const candidate of candidates) persisted.push({...await persistCandidate(candidate,snapshot,approvalMode), candidate});
  const eligible = persisted.filter(x=>x.valid).map(x=>x.plan);
  let autoApproval=null;
  if (approvalMode === 'ai' && eligible.length) autoApproval = await autoActivateBestCandidate(eligible);

  return {
    engine:ENGINE_VERSION, astra_called:false, events:candidates.map(c=>c.state),
    plans:persisted.map(x=>({plan_id:x.plan?.plan_id,status:x.plan?.status,created:x.created,setup_score:x.candidate.setup_score,pattern:x.candidate.pattern_name,confluence:x.candidate.confluence||[]})),
    expired_plans:expiredPlans.length, auto_approval:autoApproval
  };
}
