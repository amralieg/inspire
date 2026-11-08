const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const I = require('../lib/inspireImplement');
const { emptyScopeWarning, readinessScope } = require('../../frontend/src/lib/implementWizard.js');

const OWNER = ['owner', 'example.com'].join('@');
const PERSON_TOKEN = 'person-token';
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const OUT = 'result_table=main.inspire.churn_out';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '' };
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
const NOT_MINE_SCHEMA = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'amr@x' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'amr@x' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
];
const CANNOT_SHARE = [...NOT_MINE_SCHEMA,
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'analysts', mine: 'true', me: 'amr@x' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
  { level: 'table', privilege: 'MODIFY', principal: 'analysts', mine: 'true', me: 'amr@x' },
  { level: 'table', privilege: 'SELECT', principal: 'analysts', mine: 'true', me: 'amr@x' }];
const KEY_COLUMNS = ['use_case_id', 'run_id', 'as_of_date', 'score'].map((column_name) => ({ column_name }));

async function withApp(overrides, run) {
  const made = makeApp({ useCase: USE_CASE, forwardedToken: PERSON_TOKEN, forwardedEmail: OWNER, ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, url, { method = 'GET', body } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

const preflight = (url, extra = '') => call(url, `/api/inspire/implement/preflight?${Q}&${OUT}${extra}`);
const submit = (url, spec = SPEC) => call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec } });
const plan = (url, spec = SPEC) => call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec } });
const insertedSpec = (made) => JSON.parse(made.sqlCalls.find((c) => /^INSERT/.test(String(c.sql)) && String(c.sql).includes('__inspire_implement'))
  .parameters.find((p) => p.name === 'spec').value);

test('an access check the warehouse could not finish lets Build go on with a warning, and a denied warehouse still blocks (must-exclude)', async () => {
  await withApp({ accessError: 'Statement timed out after 50 seconds' }, async (url) => {
    const got = await preflight(url, '&app_name=churn-desk');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.ok, true, JSON.stringify(got.data.checks));
    assert.match(got.data.checks.warehouse.detail, /could not run a statement for you: Statement timed out/);
    assert.equal(got.data.checks.warehouse.warn, 'Build still runs, and the build checks this again.');
    for (const name of ['output', 'app_access']) assert.equal(got.data.checks[name].ok, true, name);
  });
  await withApp({ accessError: 'PERMISSION_DENIED: You do not have CAN_USE on warehouse wh1' }, async (url) => {
    const got = await preflight(url, '&app_name=churn-desk');
    assert.equal(got.data.ok, false);
    assert.deepEqual([got.data.checks.warehouse.ok, got.data.checks.output.ok, got.data.checks.app_access.ok], [false, false, false]);
  });
});

test('Build never blocks on a guessed Apps limit: an unanswered list, a long list and a workspace with Apps all go on, and only a workspace without Apps says no (must-exclude)', async () => {
  const room = I.appsRoomCheck(true);
  await withApp({ responses: { 'GET /api/2.0/apps': [{ message: 'upstream unavailable' }, 503] } }, async (url) => {
    const got = await preflight(url, '&app_name=churn-desk');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.ok, true, JSON.stringify(got.data.checks));
    assert.deepEqual(got.data.checks.apps, room);
    assert.equal(got.data.features.apps, true);
    assert.equal(got.data.features.apps_unchecked, undefined);
  });
  await withApp({ appsOk: false }, async (url) => {
    const got = await preflight(url, '&app_name=churn-desk');
    assert.deepEqual([got.data.ok, got.data.checks.apps.ok], [false, false], 'a workspace without Apps still says no');
  });
  const many = { apps: Array.from({ length: 163 }, (_, i) => ({ name: `app-${i}` })) };
  await withApp({ appsList: many }, async (url) => {
    const got = await preflight(url, '&app_name=churn-desk');
    assert.deepEqual([got.data.ok, got.data.checks.apps], [true, room], '163 Apps is not a full workspace');
    assert.doesNotMatch(JSON.stringify(got.data.checks), /of its \d+ Apps/);
  });
});

test('a share the person cannot make never blocks the build: the version builds without it and says so', async () => {
  const shared = { ...SPEC, sharing: { principals: [{ type: 'group', name: 'analysts' }] } };
  await withApp({ access: CANNOT_SHARE, columns: KEY_COLUMNS }, async (url, made) => {
    const got = await submit(url, shared);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
    assert.equal(got.data.warnings.length, 1);
    assert.equal(got.data.warnings[0], 'Built without sharing: amr@x, the identity Inspire builds as, cannot share main.inspire.churn_out: '
      + 'it needs to own it, its schema or its catalog, or hold MANAGE on one of them. Share main.inspire.churn_out once it can.');
    assert.deepEqual(insertedSpec(made).sharing.principals, [], 'the build job skips the sharing');
  });
  await withApp({ access: CANNOT_SHARE, columns: KEY_COLUMNS, forwardedToken: 'tok' }, async (url, made) => {
    const got = await submit(url, shared);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.warnings[0], 'Built without sharing: you cannot share main.inspire.churn_out: '
      + 'you need to own it, its schema or its catalog, or hold MANAGE on one of them. Share main.inspire.churn_out once you can.');
    assert.doesNotMatch(got.data.warnings[0], /identity Inspire builds as|once it can/, 'a build that runs as the person says you (must-exclude)');
    assert.equal(made.jobs.length, 1);
  });
  await withApp({ access: CANNOT_SHARE, columns: KEY_COLUMNS }, async (url, made) => {
    const got = await submit(url, SPEC);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, [], 'nothing to share, nothing to say');
    assert.equal(made.jobs.length, 1);
  });
  await withApp({ access: NOT_MINE_SCHEMA }, async (url, made) => {
    const got = await submit(url, shared);
    assert.equal(got.status, 403, 'a result table the person cannot write still blocks');
    assert.equal(made.jobs.length, 0);
  });
});

test('the server counts the rows before a plan or a build, warns when there are none or it could not count, and never blocks on it', async () => {
  const scope = readinessScope({ ...SPEC, data: {} }, USE_CASE);
  assert.equal(scope.table, 'main.s.orders');
  await withApp({ readinessRows: [{ row_count: '0' }] }, async (url, made) => {
    const planned = await plan(url);
    assert.equal(planned.status, 200, JSON.stringify(planned.data));
    assert.deepEqual(planned.data.warnings, [emptyScopeWarning(scope, ['main.s.orders'])]);
    assert.match(planned.data.warnings[0], /the only table you picked, is empty, so no use case can be grounded in rows/);
    const got = await submit(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, [emptyScopeWarning(scope, ['main.s.orders'])]);
    assert.equal(made.jobs.length, 1, 'an empty table warns, it does not stop the build');
    const counts = made.sqlCalls.filter((c) => /^SELECT COUNT\(\*\) AS row_count/.test(String(c.sql)));
    assert.ok(counts.length >= 2 && counts.every((c) => c.token === PERSON_TOKEN), 'counted with the person\u2019s own token');
  });
  const twoTables = { ...USE_CASE, tables_involved: 'main.s.orders, main.s.returns' };
  await withApp({ useCase: twoTables, readinessRows: [{ row_count: '0' }] }, async (url) => {
    const got = await plan(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, ['Warning: every table you picked is empty (main.s.orders, main.s.returns), so no use case can be grounded in rows. You can go on.'],
      'the server says what the wizard says when every table is empty');
  });
  await withApp({ useCase: twoTables, readinessByTable: { 'main.s.orders': '0', 'main.s.returns': '40' } }, async (url) => {
    const got = await plan(url);
    assert.deepEqual(got.data.warnings, [emptyScopeWarning(scope)], 'one empty table among tables with rows keeps the first-run wording (must-exclude)');
    assert.match(got.data.warnings[0], /the MVP Test Run may write no rows/);
  });
  await withApp({ useCase: twoTables, readinessRows: [{ row_count: '0' }], sqlErrors: { 'row_count FROM `main`.`s`.`returns`': 'warehouse stopped' } }, async (url) => {
    const got = await plan(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, [emptyScopeWarning(scope)], 'a table Inspire could not count is not called empty (must-exclude)');
  });
  await withApp({ readinessRows: [{ row_count: '1200' }] }, async (url) => {
    const got = await submit(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, [], 'rows present, nothing to say');
  });
  await withApp({ sqlErrors: { 'SELECT COUNT(*) AS row_count': 'warehouse stopped' } }, async (url, made) => {
    const got = await submit(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, ['Inspire could not count the rows in main.s.orders. The build checks the data itself.']);
    assert.equal(made.jobs.length, 1);
  });
});

test('the server builds without an ask Inspire does not build, names it, and keeps the built version live when no choice came', async () => {
  const vibes = 'delete source rows from main.s.orders\nAdd a region filter';
  await withApp({ columns: KEY_COLUMNS }, async (url, made) => {
    const got = await submit(url, { ...SPEC, vibes });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
    assert.equal(insertedSpec(made).vibes, 'Add a region filter');
    assert.match(got.data.warnings[0], /^Inspire builds without this ask: “delete source rows from main\.s\.orders”/);
  });
  await withApp({ columns: KEY_COLUMNS }, async (url, made) => {
    const got = await submit(url, { ...SPEC, vibes: 'delete source rows from main.s.orders' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(String(insertedSpec(made).vibes ?? ''), '', 'an ask alone is taken out and the version still builds');
    assert.equal(insertedSpec(made).vibe_previous, undefined);
  });
  const history = [{ spec_version: 1, status: 'ready', spec_json: SPEC }];
  await withApp({ columns: KEY_COLUMNS, history }, async (url, made) => {
    const got = await submit(url, { ...SPEC, vibes: 'Add a region filter', based_on_version: 1 });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(insertedSpec(made).vibe_previous, 'keep');
  });
});
