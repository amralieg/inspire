// REQ-456/461 (FX-52, W18a D52): a source Inspire cannot share with the new App blocks the build before it starts.
// The plan carries blocking:true and the exact GRANT for the data owner; submit refuses with 403 and the same GRANT, and starts no job.
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
const MANAGES = [
  { level: 'catalog', privilege: 'OWNER', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
];
const SPEC = {
  use_case_id: 'N01-U01', use_case_name: 'Assess water assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, alert: false, app: true, app_name: 'riverside-assets', app_access: 'sp' },
};

async function withInspireRows(rows, run) {
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    me: { applicationId: 'app-sp-2', displayName: 'riverside-assets' },
    tokenKind: 'app',
    forwardedToken: 'person-tok',
    history: [],
    statements: { 'system.information_schema.catalogs': (_s, _p, token) => ({ rows: token === APP_TOKEN ? rows : [] }) },
  });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}
const post = async (base, route) => {
  const resp = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC }) });
  return { status: resp.status, data: await resp.json() };
};

test('the plan for a source Inspire cannot share is blocking and carries the exact GRANT for the data owner; the warning text is unchanged', async () => {
  await withInspireRows(READS_ONLY, async (url) => {
    const got = await post(url, '/api/inspire/implement/plan');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const reads = got.data.summary.app_reads;
    assert.equal(reads.blocking, true);
    assert.ok(Array.isArray(reads.grant) && reads.grant.length > 0, JSON.stringify(reads));
    assert.ok(reads.grant.every((s) => /^GRANT MANAGE ON (CATALOG|SCHEMA|TABLE) `main`.* TO `inspire-sp`$/.test(s)), JSON.stringify(reads.grant));
    assert.deepEqual(reads.tables, [{ table: 'main.s.orders', owner: 'admins and data-eng' }]);
    assert.ok(got.data.warnings.some((w) => w.startsWith('Inspire cannot share main.s.orders (owned by admins and data-eng)')));
  });
});

test('submit refuses with 403 and the same GRANT, and starts no job (must-keep: a source Inspire manages builds)', async () => {
  await withInspireRows(READS_ONLY, async (url, made) => {
    const plan = await post(url, '/api/inspire/implement/plan');
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 403, JSON.stringify(got.data));
    for (const s of plan.data.summary.app_reads.grant) assert.ok(got.data.error.includes(s), `${s} in ${got.data.error}`);
    assert.equal(made.jobs.length, 0);
    assert.ok(!made.sqlCalls.some((c) => String(c.sql).includes('INSERT INTO')));
  });
  await withInspireRows(MANAGES, async (url, made) => {
    const plan = await post(url, '/api/inspire/implement/plan');
    assert.equal('app_reads' in plan.data.summary, false);
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
  });
});
