import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_EXPERIENCE_CHOICES, APP_EXPERIENCE_DEFAULT, IMPLEMENT_OUTPUTS, experienceDefault, experienceOf, withAppOption } from '../src/lib/implementWizard.js';

test('the delivery step labels the App "App" (REQ-209)', () => {
  const app = IMPLEMENT_OUTPUTS.find((o) => o.id === 'app');
  assert.equal(app.label, 'App');
});

test('the experience decision offers Classic UI (default), Agentic and Both, and Classic UI is the default', () => {
  assert.deepEqual(APP_EXPERIENCE_CHOICES.map((c) => c.id), ['agentic', 'ui', 'both']);
  assert.equal(APP_EXPERIENCE_DEFAULT, 'ui');
  assert.equal(APP_EXPERIENCE_CHOICES.find((c) => c.id === 'ui').label, 'Classic UI (default)');
  assert.equal(APP_EXPERIENCE_CHOICES.find((c) => c.id === 'agentic').label, 'Agentic', 'only the default carries the word default');
});

test('an unknown experience falls back to the default, and a chosen one is kept', () => {
  assert.equal(experienceOf('bogus'), 'ui');
  assert.equal(experienceOf('ui'), 'ui');
});

test('choosing an experience keeps the string; the other options stay booleans', () => {
  const spec = { outputs: { app_options: { modify: true, decisions: true } } };
  const next = withAppOption(spec, 'experience', 'both');
  assert.equal(next.outputs.app_options.experience, 'both');
  assert.equal(withAppOption(next, 'decisions', false).outputs.app_options.decisions, false);
});

test('a rebuild pre-selects classic (ui) when the App never chose; a new build pre-selects classic (ui) too', () => {
  assert.equal(experienceDefault({ based_on_version: 3 }), 'ui');
  assert.equal(experienceDefault({}), 'ui', 'a new build the wizard has not touched starts classic');
});
