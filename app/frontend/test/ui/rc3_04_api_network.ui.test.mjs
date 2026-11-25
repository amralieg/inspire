import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApiFetch, makeApiPostJson } from '../../src/lib/apiClient.js';
import { splitTechnical } from '../../src/lib/plainText.js';

// RC3-04: a read that got no answer (the browser's own "Failed to fetch") reached the Build page as raw browser text, and was never
// tried again. The App's own client turns a network failure into the plain sentence (every caller, whatever it renders the message
// with), and tries a read once more before it fails, as the MVP App client already does (app/agent/agent/app_shell/web/src/api.js).
const NETWORK = splitTechnical('Failed to fetch').plain;
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

function plant(answers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}
const dropped = () => new TypeError('Failed to fetch');

test('RC3-04 a read that gets no answer once is tried again and its answer is used', async () => {
  const calls = plant([dropped(), { body: { items: [{ feedback_id: 'f1' }] } }]);
  const got = await makeApiFetch({ token: 't' })('/api/inspire/implement/feedback?use_case_id=N01-U01');
  assert.deepEqual(got, { items: [{ feedback_id: 'f1' }] });
  assert.equal(calls.length, 2, 'one more try after the network failure');
});

test('RC3-04 a read that never gets an answer fails with the plain sentence, never the browser\'s words', async () => {
  const calls = plant([dropped()]);
  const err = await makeApiFetch({ token: 't' })('/api/inspire/implement/feedback').then(() => null, (e) => e);
  assert.ok(err, 'the read fails');
  assert.equal(err.message, NETWORK);
  assert.doesNotMatch(err.message, /Failed to fetch/);
  assert.ok(err.cause instanceof TypeError, 'the browser error is kept on the error for Details');
  assert.equal(calls.length, 2, 'tried twice in all, not more');
  const shown = splitTechnical(`Inspire could not read the reported issues: ${err.message}`).plain;
  assert.equal(shown, `Inspire could not read the reported issues: ${NETWORK}`);
});

test('RC3-04 a write that gets no answer is not sent again, and fails with the plain sentence (Request access, Not a change)', async () => {
  const calls = plant([dropped(), { body: { ok: true } }]);
  const err = await makeApiPostJson({ token: 't' })('/api/access-request', { objects: [] }, { raise: false }).then(() => null, (e) => e);
  assert.ok(err, 'the write fails');
  assert.equal(err.message, NETWORK);
  assert.equal(calls.length, 1, 'a write is never repeated on its own');
});

test('RC3-04 must-keep: an answer from the App is not retried and keeps its own words; a cancelled request stays cancelled', async () => {
  const calls = plant([{ status: 500, body: { error: 'The warehouse is stopped' } }, { body: { ok: true } }]);
  const err = await makeApiFetch({ token: 't' })('/api/inspire/implement/feedback').then(() => null, (e) => e);
  assert.equal(err?.status, 500);
  assert.match(err.message, /The warehouse is stopped/);
  assert.equal(calls.length, 1, 'an HTTP answer is not a network failure');
  const ok = plant([{ body: { items: [] } }]);
  assert.deepEqual(await makeApiFetch({})('/api/x'), { items: [] });
  assert.equal(ok.length, 1);
  plant([Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })]);
  const aborted = await makeApiPostJson({})('/api/x', {}, { signal: AbortSignal.abort() }).then(() => null, (e) => e);
  assert.equal(aborted?.name, 'AbortError', 'a cancel is not turned into a lost connection');
});
