// REQ-418 / D-SL-10B: a built App reads with its service principal by default. The "who sees which rows" choice is asked only where a
// source has a row filter or column mask, or under Advanced settings once the App is built (Add/Remove/Vibe). Pure rules, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ACCESS_DEFAULT, APP_ACCESS_POLICY_WHY, appAccessShown, wizardSteps } from '../src/lib/implementWizard.js';

const appSpec = () => ({ outputs: { app: true, merge: { app: '' }, app_placement: 'domain', app_access: APP_ACCESS_DEFAULT } });
const NONE = { grouping: false, firstRun: false };
const where = (scope) => wizardSteps('mvp', appSpec(), scope).find((step) => step.id === 'where');

test('a built App reads with its service principal by default', () => {
  assert.equal(APP_ACCESS_DEFAULT, 'sp');
});

test('a source with no row filter or column mask hides the identity step, and the rest of the App panels stay', () => {
  const step = where({ ...NONE, policied: false, editing: false });
  assert.equal(step.panels.includes('app_access'), false);
  assert.ok(step.panels.includes('app_place') && step.panels.includes('app_features') && step.panels.includes('app_look'));
});

test('a source with a row filter or column mask shows the identity step, with its one plain line', () => {
  const step = where({ ...NONE, policied: true, editing: false });
  assert.equal(step.panels.includes('app_access'), true);
  assert.equal(step.advanced.includes('app_access'), false);
  assert.match(APP_ACCESS_POLICY_WHY, /row filter or column mask/);
});

test('Add/Remove/Vibe (an App already built) shows the per-user choice under Advanced settings, with or without policies', () => {
  for (const policied of [false, true]) {
    const step = where({ ...NONE, policied, editing: true });
    assert.equal(step.panels.includes('app_access'), true, `policied=${policied}`);
    assert.deepEqual(step.advanced, ['app_access'], `policied=${policied}`);
  }
});

test('with no scope given, the identity step is hidden: the App reads with its service principal', () => {
  assert.equal(appAccessShown(undefined), false);
  assert.equal(where(undefined).panels.includes('app_access'), false);
});
