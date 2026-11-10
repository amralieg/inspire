const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const PERSON_TOKEN = 'person-token';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '' };
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
const builtRow = () => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(SPEC, 'https://inspire.example.com')).spec), app_name: '',
  asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 } }),
});

async function submitAgainstBuilt(body) {
  const made = makeApp({ useCase: USE_CASE, forwardedToken: PERSON_TOKEN, forwardedEmail: OWNER, history: [builtRow()] });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...DB, spec: SPEC, ...body }) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('an unchanged version is refused, and Rebuild as is builds it again', async () => {
  const refused = await submitAgainstBuilt({});
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.match(refused.data.error || JSON.stringify(refused.data), /nothing changed since version 1/);
  const again = await submitAgainstBuilt({ rebuild_as_is: true });
  assert.doesNotMatch(JSON.stringify(again.data), /nothing changed since version/, 'Rebuild as is never gets the unchanged refusal');
});
