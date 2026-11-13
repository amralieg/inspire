import test from 'node:test';
import assert from 'node:assert/strict';
import { WIZARD_STEPS_MAX, wizardSteps } from '../../src/lib/implementWizard.js';

const WITH_APP_AND_SCOPE = { grouping: true, firstRun: true };
const APP_SPEC = { outputs: { app: true, app_placement: 'domain', merge: {} } };

test('the MVP wizard has at most 10 steps, with the App and every scope step on', () => {
  const steps = wizardSteps('mvp', APP_SPEC, WITH_APP_AND_SCOPE);
  assert.deepEqual(steps.map((s) => s.label), ['What to deliver', 'Data & results', 'Data groups', 'First run', 'Measure', 'Where it lives',
    'Who uses the App and storage', 'App look', 'Review & build']);
  assert.ok(steps.length <= WIZARD_STEPS_MAX, `${steps.length} steps`);
  assert.equal(WIZARD_STEPS_MAX, 10);
});

test('Run it is gone: its schedule lives in the First run step, which every MVP keeps', () => {
  const steps = wizardSteps('mvp', APP_SPEC, { grouping: false, firstRun: false });
  assert.equal(steps.some((s) => s.id === 'run' || s.label === 'Run it'), false, 'no Run it step (must-exclude)');
  const first = steps.find((s) => s.id === 'first_run');
  assert.ok(first, 'First run step exists even without a scope to pick');
  assert.deepEqual(first.panels, ['fresh', 'schedule'], 'First run holds the Keep it fresh and schedule sections');
  assert.equal(steps.find((s) => s.id === 'data').panels.includes('fresh'), false, 'Data & results no longer holds the schedule');
});

test('the App and page storage are one step with access, features and storage in that order', () => {
  const steps = wizardSteps('mvp', APP_SPEC, WITH_APP_AND_SCOPE);
  const app = steps.find((s) => s.id === 'app');
  assert.deepEqual(app.panels, ['app_access', 'app_features', 'app_storage']);
  assert.equal(steps.some((s) => s.id === 'app_storage'), false, 'no separate Page storage step (must-exclude)');
});

test('a joined App and a use case without an App keep their short step lists', () => {
  const none = wizardSteps('mvp', { outputs: { app: false } }, { grouping: false, firstRun: false }).map((s) => s.label);
  assert.deepEqual(none, ['What to deliver', 'Data & results', 'First run', 'Measure', 'Review & build']);
  const joined = wizardSteps('mvp', { outputs: { app: true, merge: { app: 'x' } } }, { grouping: false, firstRun: true }).map((s) => s.label);
  assert.equal(joined.includes('Who uses the App and storage'), false);
});
