// REQ-456/461 (FX-52, W18a D52): Rebuild as is skips the "nothing changed" refusal, but never the block on a source Inspire cannot share.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const APP_TOKEN = 'tok';
const READS_ONLY = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'SELECT', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
];
const SPEC = {
  use_case_id: 'N01-U01', use_case_name: 'Assess water assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, alert: false, app: true, app_name: 'riverside-assets', app_access: 'sp' },
};

test('submit with rebuild_as_is still refuses with 403 for a source Inspire cannot share, and starts no job', async () => {
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    me: { applicationId: 'app-sp-2', displayName: 'riverside-assets' },
    tokenKind: 'app', forwardedToken: 'person-tok', history: [], columns: [],
    statements: { 'system.information_schema.catalogs': (_s, _p, token) => ({ rows: token === APP_TOKEN ? READS_ONLY : [] }) },
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC, rebuild_as_is: true }) });
    const data = await resp.json();
    assert.equal(resp.status, 403, JSON.stringify(data));
    assert.match(data.error, /GRANT MANAGE ON/);
    assert.equal(made.jobs.length, 0);
  } finally {
    await srv.close();
  }
});
