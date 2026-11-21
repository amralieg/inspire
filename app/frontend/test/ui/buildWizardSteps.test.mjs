// REQ-457 REQ-457a: the first step chooses Standard or Advanced; Standard is What, Look, Build; Measure is no longer a wizard step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_ADVANCED, BUILD_STANDARD, NO_SCOPE_STEPS, defaultSpecFromUseCase, initialStepId, stepErrors, wizardSteps } from '../../src/lib/implementWizard.js';

const base = defaultSpecFromUseCase({}, { warehouseId: 'wh', inspireDatabase: 'cat.sch', sessionId: 1 });
const withApp = { ...base, outputs: { ...base.outputs, app: true, app_placement: 'domain', merge: {} } };
const noApp = { ...base, outputs: { ...base.outputs, app: false } };
const joined = { ...withApp, outputs: { ...withApp.outputs, merge: { app: 'sales-hub', dashboard: '', genie_space: '' } } };
const FULL = { ...NO_SCOPE_STEPS, grouping: true, firstRun: true };
const ids = (spec, scope) => wizardSteps('mvp', spec, scope).map((s) => s.id);
const labels = (spec, scope) => wizardSteps('mvp', spec, scope).map((s) => s.label);
const sectionsOf = (spec, scope) => new Set(wizardSteps('mvp', spec, scope).flatMap((s) => s.sections));

test('1: the choice values', () => {
  assert.equal(BUILD_STANDARD, 'standard');
  assert.equal(BUILD_ADVANCED, 'advanced');
});

test('2: Standard with an App is How to build, What, Look, Build', () => {
  const scope = { ...FULL, build: BUILD_STANDARD };
  assert.deepEqual(ids(withApp, scope), ['how', 'delivery', 'where', 'summary']);
  assert.deepEqual(labels(withApp, scope), ['How to build', 'What', 'Look', 'Build']);
});

test('3: Standard with no App drops Look', () => {
  assert.deepEqual(ids(noApp, { ...FULL, build: BUILD_STANDARD }), ['how', 'delivery', 'summary']);
});

test('4: Standard Look on a joined App shows only the App place', () => {
  const look = wizardSteps('mvp', joined, { ...FULL, build: BUILD_STANDARD }).find((s) => s.id === 'where');
  assert.deepEqual(look.panels, ['app_place']);
});

test('5: Advanced is today\'s steps after How to build, with no Measure step', () => {
  const scope = { ...FULL, build: BUILD_ADVANCED };
  assert.deepEqual(ids(withApp, scope), ['how', 'delivery', 'data', 'grouping', 'first_run', 'where', 'summary']);
  assert.deepEqual(labels(withApp, scope), ['How to build', 'What to deliver', 'Data & results', 'Data groups', 'First run', 'Where it lives', 'Review & build']);
  assert.deepEqual(ids(noApp, { ...NO_SCOPE_STEPS, firstRun: true, build: BUILD_ADVANCED }), ['how', 'delivery', 'data', 'first_run', 'summary']);
});

test('6: no build choice in the scope counts as Advanced', () => {
  assert.deepEqual(ids(withApp, FULL), ids(withApp, { ...FULL, build: BUILD_ADVANCED }));
});

test('7: Standard checks every section Advanced checks (a hidden setting can still block the build)', () => {
  for (const spec of [withApp, noApp, joined]) {
    assert.deepEqual([...sectionsOf(spec, { ...FULL, build: BUILD_STANDARD })].sort(), [...sectionsOf(spec, { ...FULL, build: BUILD_ADVANCED })].sort());
  }
});

test('8: the measure settings are checked on the last step in both modes', () => {
  const bad = { ...withApp, holdout: { enabled: true, share: 60 } };
  for (const build of [BUILD_STANDARD, BUILD_ADVANCED]) {
    assert.ok(stepErrors('summary', bad, { scopeSteps: { ...FULL, build } }, 'mvp').length > 0, `${build}: Build reports the holdout share`);
  }
});

test('9: old Measure links open the last step, never a missing step', () => {
  for (const step of ['measure', 'impact', 'stake', 'kpi', 'holdout', 'money']) {
    for (const build of [BUILD_STANDARD, BUILD_ADVANCED]) {
      assert.equal(initialStepId({ step }, 'mvp', withApp, { ...FULL, build }), 'summary', `${step} (${build})`);
    }
  }
});

test('10: Advanced-only links stay on their step when the scope says Advanced', () => {
  assert.equal(initialStepId({ step: 'data' }, 'mvp', withApp, { ...FULL, build: BUILD_ADVANCED }), 'data');
  assert.equal(initialStepId({ step: 'run' }, 'mvp', withApp, { ...FULL, build: BUILD_ADVANCED }), 'first_run');
});
