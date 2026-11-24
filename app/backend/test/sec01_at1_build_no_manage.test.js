// SEC-01 AT1 (W1, D1): a Build for a person who owns a source the new MVP App cannot read never grants or returns MANAGE, and never
// runs a grant with the person's sign-in (runPersonGrants is the only path that runs GRANT SQL with the forwarded token, so a GRANT
// executed with the person token is how a runPersonGrants call is observed). The plan shows a read-only, table-level payload instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
const inspireSees = (owner) => [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'account users', mine: 'true', me: 'inspire-sp' },
  { level: 'table', privilege: 'OWNER', principal: owner, mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'SELECT', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
];
const personSees = () => [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'pat' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'pat' },
  { level: 'table', privilege: 'OWNER', principal: 'pat', mine: 'true', me: 'pat' },
];
const INSPIRE_SCHEMA = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'account users', mine: 'true', me: 'inspire-sp' },
];
const schemaOf = (params) => ((params || []).find((p) => p.name === 's') || {}).value;
const TABLES = ['main.s.orders', 'main.s.lines'];
const SPEC = {
  use_case_id: 'N01-U01', use_case_name: 'Assess assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, alert: false, app: true, app_name: 'asset-app', app_access: 'sp' },
};
const MANAGE = /GRANT\s+MANAGE/i;
const READ_ONLY = /^GRANT\s+(SELECT|USE CATALOG|USE SCHEMA|BROWSE|READ METADATA)(\s*,\s*(SELECT|USE CATALOG|USE SCHEMA|BROWSE|READ METADATA))*\s+ON\s/i;

async function ownerBuild(run) {
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Assess assets', primary_table: TABLES[0], tables_involved: TABLES.join(', ') },
    me: { applicationId: 'app-sp-2', displayName: 'asset-app' },
    tokenKind: 'app',
    forwardedToken: PERSON,
    history: [],
    columns: [],
    statements: { 'system.information_schema.catalogs': (_s, params, token) => ({ rows: schemaOf(params) === 'inspire' ? INSPIRE_SCHEMA
      : token === APP_TOKEN ? inspireSees('pat') : token === PERSON ? personSees() : [] }) },
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
const manageRun = (made) => made.sqlCalls.filter((c) => MANAGE.test(String(c.sql)));
const personGrants = (made) => made.sqlCalls.filter((c) => c.token === PERSON && /^\s*GRANT\b/i.test(String(c.sql)));
const returnedManage = (data) => (JSON.stringify(data).match(/GRANT\s+MANAGE[^"]*/gi) || []);

test('AT1: the Build plan returns no GRANT MANAGE and runs no grant; it shows a read-only, table-level payload for the new App', async () => {
  await ownerBuild(async (url, made) => {
    const got = await post(url, '/api/inspire/implement/plan');
    assert.deepEqual(returnedManage(got.data), [], 'AT1: the plan returns a MANAGE grant (appReadsByPerson / appAccessPermission)');
    assert.deepEqual(manageRun(made).map((c) => c.sql), [], 'AT1: the plan executed a MANAGE grant');
    assert.deepEqual(personGrants(made).map((c) => c.sql), [], 'AT1: the plan ran a GRANT with the person token (runPersonGrants)');
    const reads = got.data.summary && got.data.summary.app_reads;
    assert.ok(reads && Array.isArray(reads.grant) && reads.grant.length, `AT1: the plan must carry summary.app_reads.grant, the read-only payload: ${JSON.stringify(got.data.summary)}`);
    for (const sql of reads.grant) {
      assert.match(sql, READ_ONLY, `AT1: only read privileges may be asked: ${sql}`);
      if (/^GRANT\s+SELECT\b/i.test(sql)) assert.match(sql, /\sON TABLE\s/, `AT1: SELECT is table-level: ${sql}`);
    }
  });
});

test('AT1: Build submit executes no GRANT MANAGE, runs no grant with the person token, and starts no job while the App cannot read', async () => {
  await ownerBuild(async (url, made) => {
    const got = await post(url, '/api/inspire/implement/submit');
    assert.deepEqual(manageRun(made).map((c) => [c.sql, c.token]), [], 'AT1: submit executed GRANT MANAGE (appReadsByPerson commit -> runPersonGrants)');
    assert.deepEqual(personGrants(made).map((c) => c.sql), [], 'AT1: submit ran a GRANT with the person token (runPersonGrants)');
    assert.deepEqual(returnedManage(got.data), [], 'AT1: submit returned a MANAGE grant');
    assert.equal(got.status, 403, `AT1: the App cannot read a source, so submit shows the dialog: ${JSON.stringify(got.data)}`);
    assert.equal(made.jobs.length, 0, 'AT1: no job starts before the read is granted');
  });
});
