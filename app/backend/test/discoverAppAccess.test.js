const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh' };
const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const DENIED = (name) => [400, { status: { state: 'FAILED', error: { message: `[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table '${name}'.` } } }];
const rows = (list) => {
  const keys = Object.keys(list[0] || { x: 1 });
  return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: keys.map((name) => ({ name })) } },
    result: { data_array: list.map((r) => keys.map((k) => r[k])) } }];
};
const OWNS = [
  { level: 'catalog', privilege: 'OWNER', principal: PERSON_EMAIL, mine: 'true', me: PERSON_EMAIL },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: PERSON_EMAIL },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
];
const READS = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: PERSON_EMAIL },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: PERSON_EMAIL },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
  { level: 'table', privilege: 'SELECT', principal: PERSON_EMAIL, mine: 'true', me: PERSON_EMAIL },
];

function workspaceFor(personRows, live) {
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    const sql = String((call.body && call.body.statement) || '');
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    // ABAC policy read as the App: `refused` is the live 403 of a service principal without READ METADATA (the exact text Unity Catalog returns).
    if (/^\/api\/2\.1\/unity-catalog\/policies\/table\//.test(url.pathname) && live.policy === 'refused') {
      if (call.token !== SP_TOKEN) return null;
      if (live.readMetadata) return [200, {}];
      const table = decodeURIComponent(url.pathname.split('/').pop());
      return [403, { error_code: 'PERMISSION_DENIED', message: `Principal 'sp-app-id inspire-app' does not have READ METADATA on Table '${table}'.` }];
    }
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) {
      return [200, call.token === SP_TOKEN ? { userName: 'sp-app-id', applicationId: 'sp-app-id', displayName: 'inspire-app' } : { userName: PERSON_EMAIL }];
    }
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: decodeURIComponent(url.pathname.split('/').pop()) }];
    if (url.pathname === '/api/2.0/sql/statements') {
      if (/LIMIT 0/.test(sql)) return call.token === SP_TOKEN && !live.appReads ? DENIED('main.s.orders') : rows([]);
      if (/^GRANT /.test(sql)) {
        live.grants.push([sql, call.token]);
        if (call.token === PERSON && sql.includes('`sp-app-id`')) live.appReads = true;
        if (call.token === PERSON && /^GRANT READ METADATA ON (CATALOG|SCHEMA|TABLE) .* TO `sp-app-id`$/.test(sql)) live.readMetadata = true;
        return rows([]);
      }
      if (/information_schema/.test(sql)) return rows(call.token === PERSON ? personRows : []);
    }
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === '/Shared/inspire/dbx_inspire_ai_agent') {
      return [200, { object_type: 'NOTEBOOK', path: url.searchParams.get('path') }];
    }
    // A whole-catalog pick lists its schemas and tables (the picked catalog main holds schema s with table orders).
    if (url.pathname === '/api/2.1/unity-catalog/schemas') return [200, { schemas: [{ name: 's', catalog_name: 'main' }] }];
    if (url.pathname === '/api/2.1/unity-catalog/tables') return [200, { tables: [{ name: 'orders', schema_name: 's', catalog_name: 'main', table_type: 'MANAGED' }] }];
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    return null;
  };
}

async function launchWith(personRows, scope = 'main.s.orders', { policy = '', appReads = false } = {}) {
  const live = { appReads, grants: [], policy, readMetadata: false };
  const workspace = await fakeWorkspace(workspaceFor(personRows, live));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    const resp = await fetch(`${inspire.url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': scope } }) });
    return { status: resp.status, data: await resp.json(), live, calls: workspace.calls };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('SEC-01 (W1): Discover checks the App can read the picked tables and never grants with the person sign-in, even when the person can', async () => {
  const got = await launchWith(OWNS);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.live.grants, [], 'no silent person grant runs');
  assert.equal(got.live.appReads, false);
  const permissions = got.data.permissions || [];
  assert.equal(permissions.length, 1, JSON.stringify(got.data));
  assert.ok(permissions[0].statements.includes('GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-app-id`'), JSON.stringify(permissions[0]));
  assert.ok(permissions[0].statements.includes('GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `sp-app-id`'), JSON.stringify(permissions[0]));
  assert.ok(got.calls.some((c) => c.token === SP_TOKEN && /LIMIT 0/.test(String(c.body && c.body.statement))), 'the read probe runs as the App');
});

test('Discover asks for the grant as a Permission Required, grants nothing, and still starts when neither the App can read nor the person can grant', async () => {
  const got = await launchWith(READS);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.live.grants, []);
  assert.equal(got.data.run_id, '99');
  assert.equal(got.data.warnings.filter((w) => w.includes('cannot read a source table')).length, 0, 'the grant is structured, not warning text');
  const permissions = got.data.permissions || [];
  assert.equal(permissions.length, 1, JSON.stringify(got.data));
  assert.ok(permissions[0].statements.some((sql) => /^GRANT .* TO `sp-app-id`$/.test(sql)), JSON.stringify(permissions[0]));
  assert.match(permissions[0].why, /Discover reads .* as the App, and the App cannot read/);
  assert.equal(permissions[0].principal, 'inspire-app');
});

// SEC-01 (W3): a whole-catalog pick no longer widens the read to the catalog; the dialog stays table level.
test('SEC-01 (W3): Discover of a whole-catalog pick asks for table-level reads, never a SELECT on the catalog or a schema', async () => {
  const got = await launchWith(READS, 'main');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const permissions = got.data.permissions || [];
  assert.equal(permissions.length, 1, JSON.stringify(got.data));
  const statements = permissions[0].statements;
  assert.ok(statements.includes('GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-app-id`'), JSON.stringify(statements));
  assert.equal(statements.filter((sql) => /^GRANT (SELECT|READ METADATA) ON (CATALOG|SCHEMA) /.test(sql)).length, 0, `no catalog or schema read: ${JSON.stringify(statements)}`);
});

// A live case: the App reads the table through its catalog grants, and its ABAC policy read is refused for
// READ METADATA. BROWSE on the catalog is the only other grant it holds. The dialog must name READ METADATA, at schema level.
const LIVE_APP_HOLDS = [
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'sp-app-id', mine: 'false', me: PERSON_EMAIL },
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'sp-app-id', mine: 'false', me: PERSON_EMAIL },
  { level: 'catalog', privilege: 'SELECT', principal: 'sp-app-id', mine: 'false', me: PERSON_EMAIL },
  { level: 'catalog', privilege: 'BROWSE', principal: 'sp-app-id', mine: 'false', me: PERSON_EMAIL },
];

test('SELECT works but the App ABAC policy read is refused: Permission Required asks for READ METADATA at table level, nothing the App already holds (must fail before the fix)', async () => {
  const got = await launchWith([...READS, ...LIVE_APP_HOLDS], 'main.s.orders', { policy: 'refused', appReads: true });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.live.grants, [], 'the person cannot grant here, so nothing runs with the sign-in');
  const permissions = got.data.permissions || [];
  assert.equal(permissions.length, 1, JSON.stringify(got.data));
  assert.deepEqual(permissions[0].statements, ['GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `sp-app-id`'], JSON.stringify(permissions[0]));
});

test('SEC-01 (W1): the READ METADATA grant is printed for the person, never run at Discover, and Discover still starts', async () => {
  const got = await launchWith([...OWNS, ...LIVE_APP_HOLDS], 'main.s.orders', { policy: 'refused', appReads: true });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.live.grants, [], 'no grant runs with the sign-in');
  assert.equal(got.live.readMetadata, false);
  assert.deepEqual((got.data.permissions || []).map((p) => p.statements), [['GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `sp-app-id`']], JSON.stringify(got.data));
});
