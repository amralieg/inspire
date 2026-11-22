// REQ-460: uninstalling a use case whose App other use cases share also uninstalls them, but only when the person agreed.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const specFor = (id, name) => I.validateImplementSpec({
  use_case_id: id, use_case_name: name, config: { warehouse_id: 'wh1', result_table: `main.inspire.${id.toLowerCase().replace('-', '_')}_out` },
  outputs: { dashboard: true, inspire_url: 'https://inspire.example.com' },
}).spec;
const built = (id, name) => ({
  session_id: '42', use_case_id: id, spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(specFor(id, name)), app_name: 'churn-desk',
  asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 1 } }),
});
const OWN = built('N01-U01', 'Predict churn');
const OTHER = built('N01-U02', 'Forecast demand');
const USE_CASES = [{ id: 'N01-U01', use_case: 'Predict churn' }, { id: 'N01-U02', use_case: 'Forecast demand' }];

async function uninstall(extra) {
  const made = makeApp({ history: [OWN, OTHER], registry: [OWN, OTHER], useCases: USE_CASES,
    appsByName: { 'churn-desk': { name: 'churn-desk', url: 'https://churn-desk.example.com' } } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER },
      body: JSON.stringify({ ...DB, ...extra, spec: { ...specFor('N01-U01', 'Predict churn'), based_on_version: 1, uninstall: true } }) });
    const data = await resp.json();
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
      .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));
    return { status: resp.status, data, inserts, jobs: made.jobs };
  } finally {
    await srv.close();
  }
}

test('with the person\'s agreement, one uninstall version is queued for each use case that shares the App', async () => {
  const got = await uninstall({ uninstall_shared: true });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.inserts.map((s) => [s.use_case_id, s.uninstall]), [['N01-U01', true], ['N01-U02', true]]);
  assert.equal(got.jobs.length, 2, 'one uninstall run each');
});

test('without the agreement only the asked use case is uninstalled', async () => {
  const got = await uninstall({});
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.inserts.map((s) => s.use_case_id), ['N01-U01']);
  assert.equal(got.jobs.length, 1);
});
