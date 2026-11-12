const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const ME = 'analyst@example.com';
const body = (params, extra = {}) => ({ params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7301', ...params }, ...extra });
const submitted = () => S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));

test('a run that picks samples.* with no samples choice is refused before any job is submitted (fail-pre: it was submitted)', async () => {
  S.reset({ notebookPresent: true });
  const got = await S.request('POST', '/api/run', { person: ME, body: body({ '01_uc_metadata': 'samples.bakehouse.sales_transactions' }) });
  assert.equal(got.status, 409, got.text);
  assert.match(got.data.error, /Copy the samples tables into a schema you own, or use descriptions only/);
  assert.equal(submitted().length, 0, 'no job is submitted for a samples run without a choice');
});

test('a samples run with the descriptions choice runs, and a run with no samples needs no choice', async () => {
  S.reset({ notebookPresent: true });
  const described = await S.request('POST', '/api/run', { person: ME, body: body({ '01_uc_metadata': 'samples.bakehouse' }, { samples_choice: 'descriptions' }) });
  assert.equal(described.status, 200, described.text);
  S.reset({ notebookPresent: true });
  const plain = await S.request('POST', '/api/run', { person: ME, body: body({ '01_uc_metadata': 'main.s.orders' }) });
  assert.equal(plain.status, 200, plain.text);
});

test('a mixed pick is refused when any samples entry has no choice, and a samples choice on another value is not a choice', async () => {
  S.reset({ notebookPresent: true });
  const mixed = await S.request('POST', '/api/run', { person: ME, body: body({ '01_uc_metadata': 'main.s.orders, samples.bakehouse.trips' }, { samples_choice: 'descriptions' }) });
  assert.equal(mixed.status, 200, 'the descriptions choice covers the samples entry in the pick');
  S.reset({ notebookPresent: true });
  const other = await S.request('POST', '/api/run', { person: ME, body: body({ '01_uc_metadata': 'samples.bakehouse.trips' }, { samples_choice: 'copied' }) });
  assert.equal(other.status, 409, other.text);
});
