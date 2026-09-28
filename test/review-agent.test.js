import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPendingDecision } from '../src/review-agent.js';

test('rejects pending intent below 80% entry confidence', () => {
  const result = reviewPendingDecision({
    decision: 'PLACE_PENDING', regime: 'TREND_DOWN', entry_confidence: 0.79,
    entry: 4140, stop_loss: 4142, take_profit: 4136
  }, { approved: true, reasons: [] });
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.reasons.some(x => x.startsWith('ENTRY_CONFIDENCE_BELOW_0.80')));
});

test('approves pending intent at 80% entry confidence when risk passes', () => {
  const result = reviewPendingDecision({
    decision: 'PLACE_PENDING', regime: 'TREND_DOWN', entry_confidence: 0.80,
    entry: 4140, stop_loss: 4142, take_profit: 4136
  }, { approved: true, reasons: [] });
  assert.equal(result.status, 'APPROVED');
});

test('WAIT does not require pending review', () => {
  const result = reviewPendingDecision({ decision: 'WAIT', regime: 'TREND_DOWN' }, { approved: true, reasons: [] });
  assert.equal(result.status, 'NOT_REQUIRED');
});
