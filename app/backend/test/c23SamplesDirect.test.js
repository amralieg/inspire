// c23 (D-c23-01): a samples.* pick is measured directly like any readable table. There is no "cannot measure value" gate and no copy route.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const I = require('../lib/inspireImplement');

test.after(() => S.stopServer());

const ME = 'analyst@example.com';
const body = (params, extra = {}) => ({ params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7401', ...params }, ...extra });
const submitted = () => S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));

test('a run on samples.bakehouse.* with no samples choice passes the check and is submitted, not flagged "cannot measure value"', async () => {
  S.reset({ notebookPresent: true });
  const params = { '01_uc_metadata': 'samples.bakehouse.sales_transactions' };
  const check = await S.request('POST', '/api/run/check', { person: ME, body: body(params) });
  assert.equal(check.status, 200, check.text);
  assert.doesNotMatch(check.text, /cannot measure value|descriptions only|Copy the samples/i);
  const got = await S.request('POST', '/api/run', { person: ME, body: body(params) });
  assert.equal(got.status, 200, got.text);
  assert.ok(submitted().length > 0, 'the job is submitted');
});

test('a re-run of a samples run needs no recorded choice', async () => {
  S.reset({ notebookPresent: true, runStates: {} });
  const params = { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7402', '01_uc_metadata': 'samples.bakehouse' };
  const first = await S.request('POST', '/api/run', { person: ME, body: { params } });
  assert.equal(first.status, 200, first.text);
  S.state.runStates[first.data.run_id] = { life_cycle_state: 'TERMINATED', result_state: 'FAILED' };
  S.state.launchers[first.data.run_id] = ME;
  const again = await S.request('POST', `/api/run/${first.data.run_id}/again`, { person: ME, body: { session_id: '7403' } });
  assert.equal(again.status, 200, again.text);
});

test('no route answers POST /api/inspire/samples/copy, and the copy helpers are gone', async () => {
  S.reset({ notebookPresent: true });
  const got = await S.request('POST', '/api/inspire/samples/copy', { person: ME, body: { entries: ['samples.bakehouse.sales_transactions'], destination: 'main.inspire' } });
  assert.equal(got.status, 404, got.text);
  assert.equal(S.state.calls.some((c) => /^CREATE TABLE/.test(c.statement || '')), false, 'no CREATE TABLE ... AS SELECT runs');
  for (const name of ['sampleCopyStatement', 'sampleCopyRefusal', 'sampleCopyFailureKind', 'sampleCopyDestination', 'schemaCreateStatement', 'sampleSchemaMessage', 'samplesNeedChoice', 'samplesChoiceOfRun']) {
    assert.equal(I[name], undefined, `${name} is removed`);
  }
});
