const DEFAULT_MIN_CONFIDENCE = 0.80;

export function reviewPendingDecision(decision, riskReview, options = {}) {
  if (decision?.decision !== 'PLACE_PENDING') {
    return {
      status: 'NOT_REQUIRED',
      source: 'POLICY_AGENT',
      reasons: ['NON_PENDING_DECISION'],
      reviewed_at: new Date().toISOString()
    };
  }

  const reasons = [];
  const warnings = [];
  const manual = options.manual === true;
  const minConfidence = Number(process.env.REVIEW_MIN_ENTRY_CONFIDENCE || process.env.ENTRY_PENDING_THRESHOLD || DEFAULT_MIN_CONFIDENCE);
  const confidence = Number(decision?.entry_confidence ?? decision?.confidence);

  if (riskReview?.approved !== true) {
    reasons.push(...(Array.isArray(riskReview?.reasons) && riskReview.reasons.length
      ? riskReview.reasons.map(reason => `RISK:${reason}`)
      : ['RISK:NOT_APPROVED']));
  }

  if (decision?.regime === 'CHAOTIC' || decision?.regime === 'NO_TRADE') reasons.push(`REGIME:${decision.regime}`);

  if (Number.isFinite(confidence) && confidence < minConfidence) {
    if (manual) warnings.push(`MANUAL_CONFIDENCE_OVERRIDE:${confidence.toFixed(2)}<${minConfidence.toFixed(2)}`);
    else reasons.push(`ENTRY_CONFIDENCE_BELOW_${minConfidence.toFixed(2)}`);
  }

  if (!decision?.entry || !decision?.stop_loss || !decision?.take_profit) reasons.push('MISSING_PRICE_STRUCTURE');

  return {
    status: reasons.length ? 'REJECTED' : 'APPROVED',
    source: manual ? 'MANUAL_POLICY_AGENT' : 'POLICY_AGENT',
    reasons,
    warnings,
    reviewed_at: new Date().toISOString(),
    policy: {
      min_entry_confidence: minConfidence,
      manual_confidence_override: manual,
      requires_risk_approval: true,
      rejects_regimes: ['CHAOTIC', 'NO_TRADE']
    }
  };
}
