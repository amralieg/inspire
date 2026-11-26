// c25_nodate: an error Retry cannot fix (HTTP 4xx) offers no Retry; a 5xx or a network error keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBulk, canRetry } from '../src/lib/valueBulk.js';

const failWith = async (err) => {
  const rows = await runBulk({ items: [{ id: 'N01-U01' }], worker: async () => { throw err; } });
  return rows[0];
};
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test('a 400 or 404 failure offers no Retry', async () => {
  for (const status of [400, 404]) assert.equal(canRetry(await failWith(httpError(status))), false, String(status));
});
test('a 500 or a network error keeps Retry', async () => {
  assert.equal(canRetry(await failWith(httpError(500))), true);
  assert.equal(canRetry(await failWith(new Error('Failed to fetch'))), true);
});
