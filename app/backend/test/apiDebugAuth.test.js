const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

test('/api/debug/auth is gone and answers 404, not the page', async () => {
  S.reset();
  const got = await S.request('GET', '/api/debug/auth');
  assert.equal(got.status, 404, got.text.slice(0, 200));
  assert.ok(got.data && typeof got.data.error === 'string', 'a JSON 404, not the SPA page');
  assert.equal(S.state.calls.filter((c) => c.category === 'action').length, 0);
});

test('an unknown /api path answers JSON 404 instead of the SPA page', async () => {
  S.reset();
  const got = await S.request('GET', '/api/no-such-route');
  assert.equal(got.status, 404);
  assert.doesNotMatch(got.text, /<div id="root"/);
});

test('/api/health carries no token previews', async () => {
  S.reset();
  const got = await S.request('GET', '/api/health');
  assert.equal(got.status, 200);
  for (const key of ['serviceTokenPreview', 'forwardedTokenPreview']) assert.equal(key in got.data, false, key);
  assert.doesNotMatch(JSON.stringify(got.data), new RegExp(S.APP_SP.slice(0, 8)));
  assert.doesNotMatch(JSON.stringify(got.data), new RegExp(S.PERSON_TOKEN));
});
