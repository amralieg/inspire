const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const RP = require('../lib/routePolicy');
const { makeApp, listen } = require('./support/implementApp');

// Who may grant read access on a built App's data, enforced by the real route policy (the gate every POST implement route
// runs through in server.js). Owner: the person who created the build. Other: a person with the history table's SELECT only.
const SESSION = '42';
const Q = `inspire_database=main.inspire&warehouse_id=wh1&session_id=${SESSION}&use_case_id=N01-U01`;
const OWNER = 'owner@x';
const OTHER = 'other@x';
const PERSON_TOKEN = 'person-tok';
const VIEW = 'main.s.orders_scope';
const HOST_SP = 'app-sp-id';
const BUILT_SP = 'built-sp-id';

function build({ access = 'user', sp = BUILT_SP } = {}) {
  return {
    session_id: 42, use_case_id: 'N01-U01', spec_version: 3, status: 'ready_with_warnings', app_name: 'riverside-assets', created_by: OWNER,
    spec_json: JSON.stringify({ use_case_id: 'N01-U01', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { app: true } }),
    asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 3, views: [VIEW], access_mode: access } }),
    built_sp: sp,
  };
}

// Only the workspace facts the grant plan reads: the caller holds MANAGE on the schema and USE on the catalog, so every
// statement the plan needs is grantable by them. Every GRANT is recorded with the token it ran with.
function harness(extra = {}) {
  const grants = [];
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'true', me: OWNER },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: OWNER },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: OWNER },
    { level: 'schema', privilege: 'MANAGE', principal: OWNER, mine: 'true', me: OWNER },
  ];
  const overrides = {
    useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    history: [build()],
    forwardedToken: PERSON_TOKEN,
    forwardedEmail: OWNER,
    statements: {
      'system.information_schema.catalogs': () => ({ rows: rows() }),
      'GRANT ': (sql, _p, token) => { grants.push([sql, token]); return { rows: [] }; },
    },
    responses: { 'GET /api/2.0/permissions/apps/riverside-assets': [{ access_control_list: [{ user_name: OWNER, all_permissions: [{ permission_level: 'IS_OWNER' }] }] }, 200] },
    ...extra,
  };
  return { grants, overrides };
}

// The same policy the server applies: who is the person, which App is the host, and who owns the record.
function policyFor(w) {
  return RP.createRoutePolicy({
    enforce: () => true,
    appName: () => 'inspire-host',
    appDatabase: () => 'main.inspire',
    personOf: (req) => RP.forwardedPerson(req.headers),
    personToken: (req) => String(req.headers['x-forwarded-access-token'] || ''),
    readAcl: async (req, token) => (w.overrides.person_is_manager ? { ok: true, data: {} }
      : { ok: false, status: 403, data: { error_code: 'PERMISSION_DENIED' } }),
    readMe: async () => ({ ok: true, data: {} }),
    readLauncher: async () => w.overrides.launcher || '',
    runRecorded: async () => false,
    readHistory: async (req, sid) => (w.overrides.history || []).filter((r) => String(r.session_id) === String(sid))
      .map((r) => I.parseImplementRow(r)),
  });
}

async function withPolicy(w, run) {
  const policy = policyFor(w);
  const made = makeApp(w.overrides, { mount: (app) => RP.enforceRoutePolicy(app, policy) });
  const srv = await listen(made.app);
  try { await run(srv.url, made); } finally { await srv.close(); }
}

async function call(base, route, body, headers = {}) {
  const resp = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: resp.status, data: await resp.json() };
}

const GRANT_ROUTE = `/api/inspire/implement/app-reads?${Q}`;

test('the owner of the build can grant read access on its App data, and the grant runs with the person token', async () => {
  const w = harness();
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(w.grants.length > 0, 'the owner runs grants');
    assert.ok(w.grants.every(([, token]) => token === PERSON_TOKEN), 'every grant runs with the person token');
  });
});

test('another reader of the history table cannot grant on a build they do not own: refused, and not one grant runs', async () => {
  const w = harness({ forwardedEmail: OTHER });
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'grant' });
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.match(got.data.message || got.data.error || '', /Only an owner of/);
    assert.equal(w.grants.length, 0, 'no grant call is made');
  });
});

test('a signed-out request is denied before any grant, and reads nothing it would grant', async () => {
  const w = harness({ forwardedEmail: undefined, forwardedToken: undefined });
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'grant' });
    assert.ok(got.status === 401 || got.status === 403, JSON.stringify(got.data));
    assert.equal(w.grants.length, 0);
  });
});

test('a check by another reader with record visibility shows what is short, and runs nothing: the owner can hand the SQL on', async () => {
  const w = harness({ forwardedEmail: OTHER });
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'check' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(w.grants.length, 0);
  });
});

test('a check by the owner shows the grant SQL it needs and never grants', async () => {
  const w = harness();
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'check' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(got.data.tables.some((t) => t.grants.length > 0), 'the SQL it needs is listed');
    assert.equal(w.grants.length, 0, 'a check never grants');
  });
});

test('an unknown action is refused before any read or grant', async () => {
  const w = harness();
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'drop' });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(w.grants.length, 0);
  });
});

test('a service-principal App is granted for the App\'s own service principal, never the Inspire host identity', async () => {
  const w = harness({ history: [build({ access: 'sp', sp: BUILT_SP })], builtAppSp: BUILT_SP, me: { applicationId: HOST_SP, userName: HOST_SP } });
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(w.grants.length > 0, 'the grant runs');
    assert.ok(w.grants.every(([sql]) => sql.endsWith(`TO \`${BUILT_SP}\``)), JSON.stringify(w.grants));
    assert.ok(!w.grants.some(([sql]) => sql.includes(HOST_SP)), 'no grant names the Inspire host service principal');
  });
});

test('a service-principal App whose platform record has no service principal grants nothing and says so', async () => {
  const w = harness({ history: [build({ access: 'sp' })], builtAppSp: '' });
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ROUTE, { action: 'grant' });
    assert.equal(got.status, 409, JSON.stringify(got.data));
    assert.equal(w.grants.length, 0);
  });
});

test('a build-context grant names only the use case\'s own source tables: a table it does not read is refused, nothing runs', async () => {
  const w = harness();
  await withPolicy(w, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { tables: ['main.s.elsewhere'] });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /not source tables of use case N01-U01/);
    assert.equal(w.grants.length, 0);
  });
});

test('a build-context grant on a table the use case reads is accepted', async () => {
  const w = harness();
  await withPolicy(w, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { tables: ['main.s.orders'] });
    assert.equal(got.status, 200, JSON.stringify(got.data));
  });
});

// Grants on a build's source tables: the owner, or the session's launcher before the first build, may run them. Every other
// request is refused before any grant is planned, and a request with no build context is a Permission Required, not a bare 400.
const GRANT_ACCESS = `/api/inspire/implement/grant-access?${Q}&kind=source_tables`;
const SWAP_SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true }, data: { tables: { 'main.s.orders': 'main.s.orders_v2' } } };

test('the first build\'s owner (the session launcher) can grant the swapped table the wizard chose, validated through the spec path', async () => {
  const w = harness({ history: [], launcher: OWNER, useCase: { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' } });
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ACCESS, { tables: ['main.s.orders_v2'], spec: SWAP_SPEC });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.error, undefined);
  });
});

test('a table the wizard spec does not name, and the use case does not read, is refused and nothing is granted', async () => {
  const w = harness({ history: [], launcher: OWNER, useCase: { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' } });
  await withPolicy(w, async (url) => {
    const got = await call(url, GRANT_ACCESS, { tables: ['main.s.orders_v2', 'main.s.payroll'], spec: SWAP_SPEC });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /main\.s\.payroll/);
    assert.equal(w.grants.length, 0);
  });
});

test('a person who did not launch the first build and does not own the build is refused before any grant is planned', async () => {
  const w = harness({ history: [], launcher: OWNER, forwardedEmail: OTHER, useCase: { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' } });
  await withPolicy(w, async (url, made) => {
    const got = await call(url, GRANT_ACCESS, { tables: ['main.s.orders_v2'], spec: SWAP_SPEC });
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.equal(w.grants.length, 0);
    assert.ok(!made.sqlCalls.some((c) => /^GRANT/.test(String(c.sql))), 'no grant is run');
    assert.ok(!JSON.stringify(got.data).includes('GRANT '), 'no grant SQL reaches a person who may not run it');
  });
});

test('a grant with no build context fails closed with a structured Permission Required, not a bare 400, and runs nothing', async () => {
  const w = harness();
  await withPolicy(w, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?inspire_database=main.inspire&warehouse_id=wh1&session_id=42&kind=source_tables`,
      { tables: ['main.s.orders'] });
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.equal(got.data.policy.rule, 'owners');
    assert.equal(got.data.permissions.length, 1);
    assert.equal(got.data.permissions[0].statements.length, 0, 'no SQL for a request with no build');
    assert.ok(got.data.permissions[0].instructions[0], 'it says what is needed');
    assert.equal(w.grants.length, 0);
  });
});

test('a Check reads the App and writes nothing: no UPDATE and no grant, for a record that used to store its unread list', async () => {
  const legacy = { session_id: 42, use_case_id: 'N01-U01', spec_version: 3, status: 'ready_with_warnings', app_name: 'riverside-assets', created_by: OWNER,
    spec_json: JSON.stringify({ use_case_id: 'N01-U01', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { app: true } }),
    asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 3, unread: { app: BUILT_SP, tables: [{ table: 'main.s.orders', owner: 'data-eng',
      grants: [`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${BUILT_SP}\``] }] } } }) };
  const w = harness({ history: [legacy], builtAppSp: BUILT_SP });
  await withPolicy(w, async (url, made) => {
    const got = await call(url, GRANT_ROUTE, { action: 'check' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(w.grants.length, 0);
    assert.ok(!made.sqlCalls.some((c) => /^\s*UPDATE /.test(String(c.sql))), 'a check writes no record');
  });
});
