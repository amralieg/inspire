// REQ-514: the kept App refusal is tied to the App inputs AND the grant round, so a grant clears it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appInputsKey, outputBlocks } from '../src/lib/implementWizard.js';

const spec = { outputs: { app_name: 'churn-desk', merge: { app: '' } } };
const refusal = { ok: false, reason: 'no access' };

test('a grant (new grant round) changes the key the kept refusal is stored under', () => {
  assert.notEqual(appInputsKey(spec, 0), appInputsKey(spec, 1));
  assert.equal(appInputsKey(spec, 2), appInputsKey(spec, 2));
});

test('changed App inputs still change the key', () => {
  assert.notEqual(appInputsKey(spec, 0), appInputsKey({ outputs: { app_name: 'other' } }, 0));
});

test('a confirmed-ok live check ignores the kept refusal', () => {
  const b = outputBlocks({ apps: true }, { app: { ok: true } }, {}, null, null);
  assert.ok(!b.app);
});
