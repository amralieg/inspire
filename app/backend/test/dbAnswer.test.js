// v1.5.3-rc.2 (REQ-164): no Databricks call holds a request open forever, and a folder walk always terminates.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const { nearestExisting } = require('../lib/ucReads');

test.after(() => { S.stopServer(); delete process.env.INSPIRE_DB_ANSWER_MS; });

const within = (promise, ms = 8000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms))]);
const launch = { params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '9201', '15_operation': 'Discover Use Cases', '01_uc_metadata': 'main.s.orders' } };

test('a Databricks call that never answers fails with a reason within the answer bound, and the launch starts no job', async () => {
  S.reset({ notebookPresent: true, ucTables: { 'main.s': ['orders'] }, holdFetch: (u) => u.pathname === '/api/2.1/jobs/create' });
  process.env.INSPIRE_DB_ANSWER_MS = '200';
  const got = await within(S.request('POST', '/api/run', { person: 'launcher@example.com', body: launch }));
  assert.equal(got.status, 500, got.text.slice(0, 300));
  assert.match(got.data.error, /Databricks POST \/api\/2\.1\/jobs\/create did not answer within 200 ms/);
  assert.equal(S.state.launches.length, 0, 'no session or launch record is written when the job is not created');
});

test('a folder walk that finds nothing stops at the top, even for a path with no parent (no infinite loop)', async () => {
  let calls = 0;
  const exists = async () => { calls += 1; if (calls > 50) throw new Error('walk did not stop'); return { ok: false, status: 404, data: {} }; };
  const bare = await nearestExisting(exists, 'x', '/');
  assert.equal(bare.at, 'x');
  assert.equal(calls, 1, 'a path with no parent is asked once');
  calls = 0;
  const deep = await nearestExisting(exists, '/a/b/c', '/zz');
  assert.equal(deep.at, '/', 'the walk ends at the root');
  assert.ok(calls <= 4, `the walk takes at most one call per segment (${calls})`);
});

test('a folder walk returns the nearest folder that exists', async () => {
  const found = await nearestExisting(async (p) => (p === '/a' ? { ok: true, status: 200, data: {} } : { ok: false, status: 404, data: {} }), '/a/b/c', '/');
  assert.equal(found.at, '/a');
});
