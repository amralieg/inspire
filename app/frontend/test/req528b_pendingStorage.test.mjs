// REQ-528b: a build never goes to Delta just because the Lakebase check had not finished. While the check is pending the spec carries no app_backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { specWithBackend, sentSpec, storageChecking } from '../src/lib/implementWizard.js';

const spec = (outputs = {}) => ({ outputs: { app: true, app_backend: '', app_access: 'sp', ...outputs } });

test('a pending check is flagged, and the spec never carries a backend from it', () => {
  assert.equal(storageChecking(spec(), null), true);
  assert.equal(specWithBackend(spec(), null).outputs.app_backend, '');
  assert.equal(sentSpec(spec(), null).outputs.app_backend, '');
  assert.equal(sentSpec(spec({ app_backend: 'delta' }), null).outputs.app_backend, '', 'a stale delta is not sent while the check runs');
});

test('a decided check carries its backend', () => {
  assert.equal(storageChecking(spec(), { state: 'available' }), false);
  assert.equal(sentSpec(spec(), { state: 'available', enforce: {} }).outputs.app_backend, 'lakebase');
  assert.equal(sentSpec(spec(), { state: 'absent' }).outputs.app_backend, 'delta');
  assert.equal(sentSpec(spec(), { state: 'unknown', detail: 'timed out' }).outputs.app_backend, 'delta');
});

test('an App inside Inspire or joining another App never waits on the check', () => {
  assert.equal(storageChecking(spec({ app_placement: 'inspire' }), null), false);
  assert.equal(storageChecking(spec({ merge: { app: 'other-app' } }), null), false);
  assert.equal(sentSpec(spec({ merge: { app: 'other-app' } }), null).outputs.app_backend, 'delta');
  assert.equal(storageChecking({ outputs: { app: false } }, null), false);
});
