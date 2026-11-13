const test = require('node:test');
const assert = require('node:assert/strict');
const { answerMs, fetchWithin, DEFAULT_ANSWER_MS } = require('../lib/answerWithin');

const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; });

test('a call that never answers rejects with its label and the bound, and its signal is aborted', async () => {
  let signal = null;
  global.fetch = (url, init) => { signal = init.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); };
  await assert.rejects(fetchWithin('https://x.example/oidc/v1/token', {}, { ms: 50, label: 'The sign-in token request' }),
    /The sign-in token request did not answer within 50 ms/);
  assert.equal(signal.aborted, true);
});

test('a call that answers in time returns its response, and a failure keeps its own error', async () => {
  global.fetch = async () => ({ ok: true, status: 200 });
  assert.equal((await fetchWithin('https://x', {}, { ms: 5000 })).status, 200);
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  await assert.rejects(fetchWithin('https://x', {}, { ms: 5000 }), /ENOTFOUND/);
});

test('the bound is 120 seconds by default and set by INSPIRE_DB_ANSWER_MS when it is a positive number', () => {
  assert.equal(DEFAULT_ANSWER_MS, 120000);
  assert.equal(answerMs({}), 120000);
  assert.equal(answerMs({ INSPIRE_DB_ANSWER_MS: '200' }), 200);
  assert.equal(answerMs({ INSPIRE_DB_ANSWER_MS: '-1' }), 120000);
});
