// v1.5.3-rc.2 (REQ-164): a schema-scope launch whose tables the warehouse never lists must end with a reason, not a spinner.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => { S.stopServer(); delete process.env.INSPIRE_LAUNCH_CHECK_MS; });

const PERSON = 'launcher@example.com';
const SCHEMA = 'inspire_kinds_rc7._inspire';
const TABLES = Array.from({ length: 16 }, (_, i) => `t${i}`);
const schemaLaunch = (sessionId = '9101') => ({ params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': sessionId,
  '15_operation': 'Discover Use Cases', '01_uc_metadata': SCHEMA } });
const stalledListing = (u) => u.pathname === '/api/2.1/unity-catalog/tables';
// The request must answer within `ms`, or the test fails the way the user saw it: a spinner that never stops.
const within = (promise, ms = 8000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms))]);
const jobsStarted = () => S.state.calls.filter((c) => c.path === '/api/2.1/jobs/create' || c.path === '/api/2.1/jobs/run-now');

test('a schema-scope launch whose table listing never answers ends with the reason, starts no job and records no session', async () => {
  S.reset({ notebookPresent: true, ucSchemas: { inspire_kinds_rc7: ['_inspire'] }, ucTables: { [SCHEMA]: TABLES }, holdFetch: stalledListing });
  process.env.INSPIRE_LAUNCH_CHECK_MS = '300';
  const got = await within(S.request('POST', '/api/run', { person: PERSON, body: schemaLaunch() }));
  assert.equal(got.status, 504, got.text.slice(0, 300));
  assert.match(got.data.error, /did not finish checking what it can read in the tables you picked/);
  assert.match(got.data.error, /nothing was started/);
  assert.deepEqual(jobsStarted(), [], 'no job is created or run, so a retry is safe');
  assert.equal(S.state.launches.length, 0, 'no session or launch record is written');
});

test('the check the Launch button runs stalls the same way and names the reason, not a silent wait', async () => {
  S.reset({ notebookPresent: true, ucSchemas: { inspire_kinds_rc7: ['_inspire'] }, ucTables: { [SCHEMA]: TABLES }, holdFetch: stalledListing });
  process.env.INSPIRE_LAUNCH_CHECK_MS = '300';
  const got = await within(S.request('POST', '/api/run/check', { person: PERSON, body: { params: schemaLaunch().params } }));
  assert.equal(got.status, 504, got.text.slice(0, 300));
  assert.match(got.data.error, /did not finish checking/);
});

test('a backend refusal on a schema launch shows the workspace reason verbatim (backend error shows its reason)', async () => {
  S.reset({ notebookPresent: true, ucSchemas: { inspire_kinds_rc7: ['_inspire'] }, ucTables: { [SCHEMA]: TABLES },
    createFailure: 'Cluster configuration is invalid for this workspace' });
  const got = await within(S.request('POST', '/api/run', { person: PERSON, body: schemaLaunch('9102') }));
  assert.equal(got.status, 400, got.text.slice(0, 300));
  assert.match(got.data.error, /Cluster configuration is invalid for this workspace/);
});
