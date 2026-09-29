import test from 'node:test';
import assert from 'node:assert/strict';
import { familyForPattern, catalogEntry, qualityProfile, ANALYSIS_FAMILIES } from '../src/knowledge/technical-pattern-knowledge.js';

test('classifies key levels and chart patterns', () => {
  assert.equal(familyForPattern('RESISTANCE_PROXIMITY').id, 'KEY_LEVEL');
  assert.equal(familyForPattern('SUPPORT_PROXIMITY').id, 'KEY_LEVEL');
  assert.equal(familyForPattern('CHANNEL_UP').id, 'CHART_PATTERN');
  assert.equal(catalogEntry('CHANNEL_DOWN').label, 'Channel Down');
  assert.equal(catalogEntry('RESISTANCE_PROXIMITY').family, 'KEY_LEVEL');
  assert.deepEqual(ANALYSIS_FAMILIES.CHART_PATTERN.quality_metrics, ['quality','clarity','initial_trend','uniformity','breakout','volume']);
});

test('builds bounded quality profile without claiming probability', () => {
  const profile = qualityProfile({ quality: 82, trendStrength: 70, distanceAtr: 0.2, status: 'ARMED' });
  for (const key of ['quality','clarity','initial_trend','uniformity','readiness']) {
    assert.ok(profile[key] >= 0 && profile[key] <= 1, key);
  }
  assert.equal(profile.breakout, -1);
  assert.equal(profile.volume, null);
});
