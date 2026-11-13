// rc.2 (REQ-152): the App's own agent answers Ask, so an App needs no Genie Agent. Pure rules, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GENIE_FOR_APP_NOTE, outputBlocks, stepErrors, withOutput } from '../src/lib/implementWizard.js';
import { assetUninstall } from '../src/lib/implementControl.js';

const appOnly = () => ({ outputs: { dashboard: false, genie_space: false, app: true, alert: false, app_name: 'churn-desk', app_access: 'sp' },
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, genie_questions: [], genie_space_name: '' });

test('unticking the Genie Agent while the App is on keeps the App on and the Genie Agent off', () => {
  const spec = { ...appOnly(), outputs: { ...appOnly().outputs, genie_space: true, app: true } };
  const next = withOutput(spec, 'genie_space', false, {});
  assert.equal(next.outputs.genie_space, false, 'the Genie Agent unticks even with the App on');
  assert.equal(next.outputs.app, true, 'the App stays on');
});

test('ticking the App does not tick the Genie Agent', () => {
  const spec = { ...appOnly(), outputs: { ...appOnly().outputs, app: false, genie_space: false } };
  const next = withOutput(spec, 'app', true, {});
  assert.equal(next.outputs.app, true);
  assert.equal(next.outputs.genie_space, false, 'an App needs no Genie Agent');
});

test('an App without a Genie Agent passes the use-it step with no Genie-for-App problem', () => {
  const errors = stepErrors('delivery', appOnly(), { outputBlocks: {} }, 'mvp');
  assert.equal(errors.includes('Ask Genie in the App needs a Genie Agent.'), false, 'the old rule is gone');
  assert.equal(errors.some((e) => /needs a Genie Agent/.test(e)), false, errors.join(' | '));
});

test('the Genie-for-App note says what is true: the App answers Ask itself, and a Genie Agent adds a space it can also use', () => {
  assert.equal(GENIE_FOR_APP_NOTE, "The App's own agent answers Ask. A Genie Agent adds a Genie space it can also use.");
});

test('a workspace with Genie Agents off still lets an App be built', () => {
  const blocks = outputBlocks({ apps: true, genie_spaces: false }, null, {}, null);
  assert.equal(Boolean(blocks.app), false, 'the App is not blocked by the Genie Agent feature');
  assert.equal(Boolean(blocks.genie_space), true, 'the Genie Agent itself is still blocked when its feature is off');
});

test('removing the Genie Agent of an App is not blocked by the App', () => {
  const latest = { spec_json: { outputs: { app: true, genie_space: true } } };
  const rule = assetUninstall('genie_space', latest, null, '');
  assert.equal(rule.blocked, undefined, 'no "uninstall the App first" block');
});
