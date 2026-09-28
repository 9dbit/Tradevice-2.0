const DEFAULT_MIN_CONFIDENCE = 0.55;

export function reviewPendingDecision(decision, riskReview) {
  if (decision?.decision !== 'PLACE_PENDING') {
    return {
      status: 'NOT_REQUIRED',
      source: 'POLICY_AGENT',
      reasons: ['NON_PENDING_DECISION'],
      reviewed_at: new Date().toISOString()
    };
  }

  const reasons = [];
  const minConfidence = Number(process.env.REVIEW_MIN_CONFIDENCE || DEFAULT_MIN_CONFIDENCE);
  const confidence = Number(decision?.confidence);

  if (riskReview?.approved !== true) {
    reasons.push(...(Array.isArray(riskReview?.reasons) && riskReview.reasons.length
      ? riskReview.reasons.map(reason => `RISK:${reason}`)
      : ['RISK:NOT_APPROVED']));
  }

  if (decision?.regime === 'CHAOTIC' || decision?.regime === 'NO_TRADE') {
    reasons.push(`REGIME:${decision.regime}`);
  }

  if (Number.isFinite(confidence) && confidence < minConfidence) {
    reasons.push(`CONFIDENCE_BELOW_${minConfidence.toFixed(2)}`);
  }

  if (!decision?.entry || !decision?.stop_loss || !decision?.take_profit) {
    reasons.push('MISSING_PRICE_STRUCTURE');
  }

  return {
    status: reasons.length ? 'REJECTED' : 'APPROVED',
    source: 'POLICY_AGENT',
    reasons,
    reviewed_at: new Date().toISOString(),
    policy: {
      min_confidence: minConfidence,
      requires_risk_approval: true,
      rejects_regimes: ['CHAOTIC', 'NO_TRADE']
    }
  };
}
