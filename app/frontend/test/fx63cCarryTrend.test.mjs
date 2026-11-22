// FX-63c item 3 (REQ-474): a retried plan with new trend options keeps the person's tick, not a stale option the new plan does not offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { carryAnswers, initialAnswers } from '../src/lib/valueWizard.js';

const VCP = createRequire(import.meta.url)('../../backend/lib/valueCasePlan.js');
const trend = (ids, likely) => ({ options: ids.map((id, i) => ({ id, label: id, pct: 5 + i })), likely });
const planWith = (economic_trend) => ({ ...VCP.fallbackPlan([{ column_name: 'region', data_type: 'string' }]), economic_trend });

test('a retried plan with new trend options drops the stale option, keeps the tick, and the server accepts the answers', () => {
  const first = planWith(trend(['mild', 'steep'], 'mild'));
  const before = { ...initialAnswers(first), economic_trend: { on: true, option: 'steep' } };
  const retried = planWith(trend(['calm', 'surge'], 'surge'));
  const carried = carryAnswers(retried, before);
  assert.equal(carried.economic_trend.on, true, 'the tick stays');
  assert.equal(carried.economic_trend.option, 'surge', 'the stale option is replaced by the new plan likely option');
  const got = VCP.yearlyOf(retried, carried);
  assert.equal(got.errors?.economic_trend, undefined, 'the server does not reject the carried trend');
});

test('a retried plan that still offers the saved option keeps it', () => {
  const first = planWith(trend(['mild', 'steep'], 'mild'));
  const before = { ...initialAnswers(first), economic_trend: { on: true, option: 'steep' } };
  const carried = carryAnswers(planWith(trend(['steep', 'calm'], 'calm')), before);
  assert.deepEqual(carried.economic_trend, { on: true, option: 'steep' });
});
