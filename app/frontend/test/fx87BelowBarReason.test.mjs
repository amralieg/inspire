// FX-87 (REQ-485): the "Why it is below your bar" text never shows raw column names, "=N" lists or a trailing gate name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { belowBarLabelFromUseCase, belowBarReasonOf, plainReason } from '../src/lib/useCaseFields.js';

const RAW = 'the columns it needs hold too few values (arrival_delay_minutes=10,destination_airport_iata=10,distance_nautical_miles=10,frequency_weekly=10,haul_type=10); relevance check';

test('the stored raw reason reads as plain words: no underscore, no =N, no trailing check name', () => {
  const uc = { meets_quality_bar: 'N', below_bar_reason: RAW };
  for (const text of [belowBarReasonOf(uc), belowBarLabelFromUseCase(uc), plainReason(RAW)]) {
    assert.doesNotMatch(text, /_/);
    assert.doesNotMatch(text, /=\s*\d/);
    assert.doesNotMatch(text, /\bchecks?\s*$/i);
    assert.doesNotMatch(text, /relevance/i);
    assert.match(text, /too few values/);
    assert.match(text, /\b5 columns\b/);
    assert.match(text, /arrival delay minutes/);
  }
});

test('a plain reason without details is unchanged', () => {
  assert.equal(plainReason('its title is too generic to name a decision'), 'its title is too generic to name a decision');
  assert.equal(belowBarReasonOf({ meets_quality_bar: 'N', below_bar_reason: 'it relies on simulated inputs' }), 'it relies on simulated inputs');
});
