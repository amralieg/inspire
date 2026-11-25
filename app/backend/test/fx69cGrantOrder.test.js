// FX-69c (REQ-478, REQ-483, REQ-469): the person's GRANT MANAGE runs only when the build really starts, never on an uninstall,
// and the plan never calls a table covered by the person when the identity the GRANT targets is unknown.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
const OWNER = ['owner', 'example.com'].join('@');
const row = (level, privilege, principal, mine, me) => ({ level, privilege, principal, mine, me });
const inspireSees = (me, owner) => [
  row('catalog', 'OWNER', 'admins', 'false', me), row('catalog', 'USE_CATALOG', 'account users', 'true', me),
  row('schema', 'OWNER', 'data-eng', 'false', me), row('schema', 'USE_SCHEMA', 'account users', 'true', me),
  row('table', 'OWNER', owner, 'false', me), row('table', 'SELECT', 'inspire-sp', 'true', me),
];
const personSees = [
  row('catalog', 'OWNER', 'admins', 'false', 'pat'), row('schema', 'OWNER', 'data-eng', 'false', 'pat'), row('table', 'OWNER', 'pat', 'true', 'pat'),
];
const INSPIRE_SCHEMA = [
  row('catalog', 'OWNER', 'admins', 'false', 'inspire-sp'), row('catalog', 'USE_CATALOG', 'account users', 'true', 'inspire-sp'),
  row('schema', 'OWNER', 'inspire-sp', 'true', 'inspire-sp'), row('schema', 'USE_SCHEMA', 'account users', 'true', 'inspire-sp'),
];
const schemaOf = (params) => ((params || []).find((p) => p.name === 's') || {}).value;
const SPEC = {
  use_case_id: 'N01-U01', use_case_name: 'Assess assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, alert: false, app: true, app_name: 'asset-app', app_access: 'sp' },
};
const builtRow = () => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(SPEC, 'https://inspire.example.com')).spec), app_name: 'asset-app',
  asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 }, app: { state: 'ready', spec_version: 1 } }),
});
const NO_GENIE = { gateway: { answer: () => [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: 'no such model' }, 404] } };

// SEC-01 (W1): Inspire no longer gets MANAGE from the person. A source Inspire can already share (it holds MANAGE) is the only one that passes.
async function withApp({ me = 'inspire-sp', extra = {}, shares = false } = {}, run) {
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Assess assets', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    me: { applicationId: 'app-sp-2', displayName: 'asset-app' },
    tokenKind: 'app', forwardedToken: PERSON, forwardedEmail: OWNER, history: [], columns: [],
    statements: { 'system.information_schema.catalogs': (_s, params, token) => ({ rows: schemaOf(params) === 'inspire' ? INSPIRE_SCHEMA
      : token === APP_TOKEN ? [...inspireSees(me, 'pat'), ...(shares ? [row('table', 'MANAGE', me, 'true', me)] : [])] : token === PERSON ? personSees : [] }) },
    ...extra,
  });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}
const post = async (base, route, spec = SPEC, more = {}) => {
  const resp = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec, ...more }) });
  return { status: resp.status, data: await resp.json() };
};
const grantsRun = (made) => made.sqlCalls.filter((c) => /^GRANT MANAGE /.test(String(c.sql)));

test('a submit refused as unchanged issues no GRANT MANAGE and starts no job', async () => {
  await withApp({ shares: true, extra: { history: [builtRow()] } }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /nothing changed since version 1/);
    assert.deepEqual(grantsRun(made), []);
    assert.equal(made.jobs.length, 0);
  });
});

test('a submit refused for a missing Databricks AI issues no GRANT MANAGE', async () => {
  await withApp({ extra: NO_GENIE }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 409, JSON.stringify(got.data));
    assert.deepEqual(grantsRun(made), []);
    assert.equal(made.jobs.length, 0);
  });
});

test('an uninstall issues no grant and is not refused for app reads', async () => {
  const uninstall = { ...I.validateImplementSpec(I.withInspireUrl(SPEC, 'https://inspire.example.com')).spec, based_on_version: 1, uninstall: true };
  await withApp({ extra: { history: [builtRow()], registry: [builtRow()] } }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/submit', uninstall);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(grantsRun(made), []);
    assert.equal(got.data.summary.app_reads, undefined);
    assert.equal(made.jobs.length, 1);
  });
});

test('SEC-01 (W1): a normal submit on a source Inspire can share builds, and never runs a grant with the person\'s token', async () => {
  await withApp({ shares: true }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/submit');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(made.sqlCalls.filter((c) => /^GRANT /.test(String(c.sql))), []);
    assert.equal(made.jobs.length, 1);
    assert.equal(got.data.summary.app_reads_by_you, undefined);
  });
});

test('with an empty target identity the plan lists the table as blocking with its owner, not as covered by you', async () => {
  await withApp({ me: '' }, async (url, made) => {
    const got = await post(url, '/api/inspire/implement/plan');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.summary.app_reads_by_you, undefined, JSON.stringify(got.data.summary.app_reads_by_you));
    assert.equal(got.data.summary.app_reads.blocking, true);
    assert.deepEqual(got.data.summary.app_reads.tables.map((t) => [t.table, t.owner]), [['main.s.orders', 'pat']]);
    assert.deepEqual(grantsRun(made), []);
  });
});
