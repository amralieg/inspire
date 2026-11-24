// REQ-478, REQ-469: a source Inspire cannot share with the new App, but that the signed-in person owns or manages, never stops a build.
// Build start grants Inspire's identity MANAGE on it with the person's own permissions, with no click and one info line. Only a source
// neither Inspire nor the person can grant still blocks, with each data owner named once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
// What Inspire's identity sees: account users can traverse, the person owns the table, Inspire can read it but cannot share it.
const inspireSees = (owner) => [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'account users', mine: 'true', me: 'inspire-sp' },
  { level: 'table', privilege: 'OWNER', principal: owner, mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'SELECT', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
];
// What the signed-in person sees on the same table.
const personSees = (owns) => [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'pat' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'pat' },
  { level: 'table', privilege: 'OWNER', principal: owns ? 'pat' : 'data-eng', mine: owns ? 'true' : 'false', me: 'pat' },
];
// The Inspire schema the installer made: Inspire's identity owns it, so the result table check passes.
const INSPIRE_SCHEMA = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'account users', mine: 'true', me: 'inspire-sp' },
];
const schemaOf = (params) => ((params || []).find((p) => p.name === 's') || {}).value;
const TABLES = ['main.s.orders', 'main.s.lines'];
// SEC-01 (W1): no MANAGE and no silent person grant; the owner is asked for a table-level SELECT for the new App.
const GRANTS = TABLES.map((t) => `GRANT SELECT ON TABLE ${t.split('.').map((p) => `\`${p}\``).join('.')} TO the new App's service principal`);
const SPEC = {
  use_case_id: 'N01-U01', use_case_name: 'Assess assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, alert: false, app: true, app_name: 'asset-app', app_access: 'sp' },
};

async function withRows({ owner, owns, denied }, run) {
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Assess assets', primary_table: TABLES[0], tables_involved: TABLES.join(', ') },
    me: { applicationId: 'app-sp-2', displayName: 'asset-app' },
    tokenKind: 'app',
    forwardedToken: PERSON,
    history: [],
    columns: [],
    sqlDeniedFor: denied ? { [PERSON]: { 'GRANT MANAGE': 'PERMISSION_DENIED: User does not have MANAGE on Table' } } : {},
    statements: { 'system.information_schema.catalogs': (_s, params, token) => ({ rows: schemaOf(params) === 'inspire' ? INSPIRE_SCHEMA
      : token === APP_TOKEN ? inspireSees(owner) : token === PERSON ? personSees(owns) : [] }) },
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
const grantsRun = (made) => made.sqlCalls.filter((c) => /^GRANT MANAGE /.test(String(c.sql)));

test('SEC-01 (W1): the plan for sources the signed-in person owns still blocks, names the SELECT, and grants nothing', async () => {
  await withRows({ owner: 'pat', owns: true }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/plan');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.summary.app_reads_by_you, undefined, 'no silent person grant is planned');
    assert.equal(got.data.summary.app_reads.blocking, true);
    assert.deepEqual(got.data.summary.app_reads.grant, GRANTS);
    assert.deepEqual(grantsRun(made), []);
  });
});

test('SEC-01 (W1): submit never grants for the person; it refuses with the table-level SELECT and starts no job', async () => {
  await withRows({ owner: 'pat', owns: true }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(made.sqlCalls.filter((c) => /^GRANT /.test(String(c.sql))), [], 'no GRANT of any kind is executed');
    assert.equal(got.data.request, 'person');
  });
});

test('a source neither Inspire nor the person can grant still blocks, and names each data owner once', async () => {
  await withRows({ owner: 'data-eng', owns: false }, async (url, made) => {
    const plan = await post(url, '/api/inspire/implement/plan');
    assert.equal(plan.data.summary.app_reads.blocking, true);
    assert.deepEqual(plan.data.summary.app_reads.owners, ['data-eng']);
    assert.deepEqual(plan.data.summary.app_reads.grant, GRANTS);
    assert.equal(plan.data.summary.app_reads_by_you, undefined);
    assert.ok(plan.data.summary.app_reads.grant.every((s) => !/MANAGE/.test(s)));
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(grantsRun(made), []);
  });
});

test('SEC-01 (W1): a build blocked on a source names the same GRANTs for the owner, and attempts none', async () => {
  await withRows({ owner: 'pat', owns: true, denied: true }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 403, JSON.stringify(got.data));
    for (const s of GRANTS) assert.ok(got.data.error.includes(s), `${s} in ${got.data.error}`);
    assert.deepEqual(made.sqlCalls.filter((c) => /^GRANT /.test(String(c.sql))), []);
    assert.equal(made.jobs.length, 0);
  });
});
