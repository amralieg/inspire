const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const { SAMPLES, ME } = require('./support/routeSamples');
const { SHOWCASE_HEADER, SHOWCASE_READ_ONLY, showcaseCanRead } = require('../lib/showcase');

test.after(() => S.stopServer());

const DEMO = { [SHOWCASE_HEADER]: 'taxi' };
const REFUSED = { error: SHOWCASE_READ_ONLY, showcase: true };
const DEMO_READ_ROUTE = 'ALL /showcase/:id/mvp/:mvp/api/*rest';
const demoWrites = SAMPLES.filter((s) => s.rule !== 'delegated' && s.key !== DEMO_READ_ROUTE && !showcaseCanRead(s.method, s.path.split('?')[0]));

test('in demo mode every change on the policy table gets the read-only note, never an access refusal, even from a person who manages nothing', async () => {
  S.reset();
  assert.ok(demoWrites.length >= 20, `${demoWrites.length} changing samples`);
  for (const sample of demoWrites) {
    const got = await S.request(sample.method, sample.path, { person: ME, body: sample.body, headers: DEMO });
    assert.equal(got.status, 403, `${sample.key} ${sample.name || ''}`);
    assert.deepEqual(got.data, REFUSED, `${sample.key} ${sample.name || ''}: ${got.text.slice(0, 160)}`);
  }
  const hosted = await S.request('POST', '/showcase/taxi/mvp/N01-U01/api/records/act', { person: ME, body: { page: 'p' } });
  assert.deepEqual([hosted.status, hosted.data], [403, REFUSED], 'a change sent to a hosted demo MVP App is read-only too');
  assert.deepEqual(S.state.calls.filter((c) => c.method !== 'GET' && c.path !== '/oidc/v1/token'), [], 'no demo change reached the workspace');
});

test('outside the demo the policy table still refuses a person who manages nothing, so the order only moves the demo ahead', async () => {
  S.reset();
  const managersOnly = SAMPLES.filter((s) => s.rule === 'managers' && s.method === 'POST' && s.path === '/api/publish');
  assert.equal(managersOnly.length, 1);
  const got = await S.request('POST', '/api/publish', { person: ME, body: managersOnly[0].body });
  assert.equal(got.status, 403);
  assert.notDeepEqual(got.data, REFUSED);
  assert.doesNotMatch(String(got.data && got.data.error), /This is the demo/);
  const demoRead = await S.request('POST', '/showcase/missing/mvp/missing/api/page', { person: ME, body: {} });
  assert.notEqual(demoRead.status, 403, 'a demo read is never refused by the policy table');
});
