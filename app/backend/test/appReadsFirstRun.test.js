// REQ-037 + REQ-456 (FX-60): only a source whose schema does not exist yet skips the share check (the first run creates it).
// A table that exists but is invisible to Inspire (catalog and schema seen, no table row) still blocks the build (D52 stays closed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const APP_TOKEN = 'tok';
const SCHEMA_SEEN_TABLE_HIDDEN = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'schema', privilege: 'USE SCHEMA', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
];
const SCHEMA_NOT_CREATED = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
];
const SPEC = {
  use_case_id: 'N01-U01', use_case_name: 'Assess water assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, alert: false, app: true, app_name: 'riverside-assets', app_access: 'sp' },
};

async function planWith(rows) {
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    me: { applicationId: 'app-sp-2', displayName: 'riverside-assets' },
    tokenKind: 'app',
    forwardedToken: 'person-tok',
    history: [],
    columns: [],
    statements: { 'system.information_schema.catalogs': (_s, _p, token) => ({ rows: token === APP_TOKEN ? rows : [] }) },
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(srv.url + '/api/inspire/implement/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC }) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('a source table Inspire cannot see in a schema it can see still blocks the build (D52 must-keep, fails on a table-OWNER-only check)', async () => {
  const got = await planWith(SCHEMA_SEEN_TABLE_HIDDEN);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.summary.app_reads && got.data.summary.app_reads.blocking, true, JSON.stringify(got.data.summary));
});

test('a source whose schema does not exist yet never blocks the build (REQ-037)', async () => {
  const got = await planWith(SCHEMA_NOT_CREATED);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(Boolean(got.data.summary.app_reads && got.data.summary.app_reads.blocking), false, JSON.stringify(got.data.summary));
});
