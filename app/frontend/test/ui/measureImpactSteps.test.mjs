import test from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_IMPACT_PART, NO_SCOPE_STEPS, defaultSpecFromUseCase, initialStepId, opensOnImpact, pickedSummary, stepErrors, wizardSteps } from '../../src/lib/implementWizard.js';

const base = defaultSpecFromUseCase({}, { warehouseId: 'wh', inspireDatabase: 'cat.sch', sessionId: 1 });
const withShare = (share) => ({ ...base, holdout: { enabled: true, share } });
const stepOf = (id) => wizardSteps('mvp', base, NO_SCOPE_STEPS).find((s) => s.id === id);

// REQ-457: Measure is no longer a step ('stake' is gone); its sections moved to the last step, 'summary'. Assertions below changed from 'stake' to 'summary' for that reason.
test('Measure impact is a section of the last step, and First run keeps Keep it fresh and its schedule', () => {
  assert.deepEqual(stepOf('first_run').sections, ['fresh', 'schedule'], 'First run holds no impact section (must-exclude)');
  assert.ok(stepOf('summary').sections.includes('kpi'), 'the last step holds the Target KPI');
  assert.ok(stepOf('summary').sections.includes('holdout'), 'the last step holds the holdout');
});

test('old links to Measure impact open the last step on the impact screen, and a Run it link still opens First run', () => {
  for (const step of ['kpi', 'holdout', MEASURE_IMPACT_PART]) {
    assert.equal(initialStepId({ step }, 'mvp', base), 'summary', `${step} opens the last step`);
    assert.equal(opensOnImpact({ step }), true, `${step} opens on the impact screen`);
  }
  assert.equal(opensOnImpact({ step: 'measure' }), false, 'the Value at stake link keeps opening the money part');
  assert.equal(initialStepId({ step: 'run' }, 'mvp', base), 'first_run', 'a Run it link opens First run');
});

test('a holdout share out of range blocks the last step, not First run', () => {
  const bad = withShare(60);
  assert.ok(stepErrors('summary', bad, {}, 'mvp').length > 0, 'the last step reports the share');
  assert.deepEqual(stepErrors('first_run', bad, {}, 'mvp'), [], 'First run does not');
});

test('the Target KPI and Hold back summary rows Change to the last step on the impact screen', () => {
  const rows = pickedSummary(base, [], {}).filter((r) => r.id === 'kpi' || r.id === 'holdout');
  assert.deepEqual(rows.map((r) => [r.id, r.step, r.part]), [['kpi', 'summary', 'kpi'], ['holdout', 'summary', 'holdout']]);
});
