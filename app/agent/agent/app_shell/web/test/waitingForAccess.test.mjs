import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getApp, waitingError, WAITING_FOR_ACCESS_CODE, retryable } from '../src/api.js';

const WAITING = { state: WAITING_FOR_ACCESS_CODE, message: 'This App is waiting for access to its data. Your data owner needs to grant the App access; the exact grant is under Details.', tables: ['main.s.orders'], detail: 'PERMISSION_DENIED' };

test('a data read the App cannot make arrives as a calm waiting state with the friendly message, not an HTTP error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(WAITING), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(getApp(), (error) => {
      assert.equal(error.code, WAITING_FOR_ACCESS_CODE);
      assert.equal(error.message, WAITING.message);
      assert.equal(error.calm, true);
      assert.equal(error.status, 200);
      assert.deepEqual(error.detail.tables, ['main.s.orders']);
      assert.equal(retryable(error), false, 'waiting is not retried in a loop; reloading rechecks');
      assert.doesNotMatch(error.message, /@/, 'no internal email in the friendly text');
      return true;
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a normal App answer is passed through unchanged (must-exclude)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ name: 'Pricing desk' }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    assert.deepEqual(await getApp(), { name: 'Pricing desk' });
  } finally {
    globalThis.fetch = realFetch;
  }
});
