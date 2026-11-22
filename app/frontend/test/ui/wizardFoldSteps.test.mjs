import test from 'node:test';
import assert from 'node:assert/strict';
import { WIZARD_STEPS_MAX, wizardSteps } from '../../src/lib/implementWizard.js';

const WITH_APP_AND_SCOPE = { grouping: true, firstRun: true };
const APP_SPEC = { outputs: { app: true, app_placement: 'domain', merge: {} } };

test('the MVP wizard has at most 10 steps, with the App and every scope step on', () => {
  const steps = wizardSteps('mvp', APP_SPEC, WITH_APP_AND_SCOPE);
  // REQ-457: How to build is the first step; Measure is no longer a step (its settings are asked in the value dialog on the last step).
  assert.deepEqual(steps.map((s) => s.label), ['How to build', 'What to deliver', 'Data & results', 'Data groups', 'First run', 'Where it lives', 'Review & build']);
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

test('Where it lives holds every App panel in order: place, pages, access, features, experience, storage and look (REQ-002)', () => {
  const steps = wizardSteps('mvp', APP_SPEC, WITH_APP_AND_SCOPE);
  const where = steps.find((s) => s.id === 'where');
  // REQ-418 (D-SL-11): the identity choice is shown only for a policied source; this scope has none, so it is not in the step.
  assert.deepEqual(where.panels, ['app_place', 'app_pages', 'app_features', 'app_experience', 'app_storage', 'app_look']);
  const policied = wizardSteps('mvp', APP_SPEC, { ...WITH_APP_AND_SCOPE, policied: true }).find((s) => s.id === 'where');
  assert.deepEqual(policied.panels, ['app_place', 'app_pages', 'app_access', 'app_features', 'app_experience', 'app_storage', 'app_look'], 'a policied source shows the identity choice in order (REQ-001 / D-EXP)');
  assert.equal(steps.some((s) => s.id === 'app' || s.id === 'app_storage' || s.id === 'app_look'), false, 'no separate App, Page storage or App look step (must-exclude)');
});

test('a joined App and a use case without an App keep their short step lists', () => {
  const none = wizardSteps('mvp', { outputs: { app: false } }, { grouping: false, firstRun: false }).map((s) => s.label);
  // REQ-457: How to build first, no Measure step.
  assert.deepEqual(none, ['How to build', 'What to deliver', 'Data & results', 'First run', 'Review & build']);
  const joined = wizardSteps('mvp', { outputs: { app: true, merge: { app: 'x' } } }, { grouping: false, firstRun: true }).map((s) => s.label);
  assert.equal(joined.includes('Where it lives'), true, 'a joined App still shows its place on Where it lives');
});
