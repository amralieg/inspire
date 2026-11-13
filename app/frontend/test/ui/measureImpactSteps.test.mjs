import test from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_IMPACT_PART, NO_SCOPE_STEPS, defaultSpecFromUseCase, initialStepId, opensOnImpact, pickedSummary, stepErrors, wizardSteps } from '../../src/lib/implementWizard.js';

const base = defaultSpecFromUseCase({}, { warehouseId: 'wh', inspireDatabase: 'cat.sch', sessionId: 1 });
const withShare = (share) => ({ ...base, holdout: { enabled: true, share } });
const stepOf = (id) => wizardSteps('mvp', base, NO_SCOPE_STEPS).find((s) => s.id === id);

test('Measure impact is a section of Measure, and First run keeps Keep it fresh and its schedule', () => {
  assert.deepEqual(stepOf('first_run').sections, ['fresh', 'schedule'], 'First run holds no impact section (must-exclude)');
  assert.ok(stepOf('stake').sections.includes('kpi'), 'Measure holds the Target KPI');
  assert.ok(stepOf('stake').sections.includes('holdout'), 'Measure holds the holdout');
});

test('old links to Measure impact open Measure on the impact screen, and a Run it link still opens First run', () => {
  for (const step of ['kpi', 'holdout', MEASURE_IMPACT_PART]) {
    assert.equal(initialStepId({ step }, 'mvp', base), 'stake', `${step} opens Measure`);
    assert.equal(opensOnImpact({ step }), true, `${step} opens on the impact screen`);
  }
  assert.equal(opensOnImpact({ step: 'measure' }), false, 'the Value at stake link keeps opening the money screen');
  assert.equal(initialStepId({ step: 'run' }, 'mvp', base), 'first_run', 'a Run it link opens First run');
});

test('a holdout share out of range blocks Measure, not First run', () => {
  const bad = withShare(60);
  assert.ok(stepErrors('stake', bad, {}, 'mvp').length > 0, 'Measure reports the share');
  assert.deepEqual(stepErrors('first_run', bad, {}, 'mvp'), [], 'First run does not');
});

test('the Target KPI and Hold back summary rows Change to Measure on the impact screen', () => {
  const rows = pickedSummary(base, [], {}).filter((r) => r.id === 'kpi' || r.id === 'holdout');
  assert.deepEqual(rows.map((r) => [r.id, r.step, r.part]), [['kpi', 'stake', MEASURE_IMPACT_PART], ['holdout', 'stake', MEASURE_IMPACT_PART]]);
});
