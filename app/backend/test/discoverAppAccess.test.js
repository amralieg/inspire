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
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) {
      return [200, call.token === SP_TOKEN ? { userName: 'sp-app-id', applicationId: 'sp-app-id', displayName: 'inspire-app' } : { userName: PERSON_EMAIL }];
    }
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: decodeURIComponent(url.pathname.split('/').pop()) }];
    if (url.pathname === '/api/2.0/sql/statements') {
      if (/LIMIT 0/.test(sql)) return call.token === SP_TOKEN && !live.appReads ? DENIED('main.s.orders') : rows([]);
      if (/^GRANT /.test(sql)) {
        live.grants.push([sql, call.token]);
        if (call.token === PERSON && sql.includes('`sp-app-id`')) live.appReads = true;
        return rows([]);
      }
      if (/information_schema/.test(sql)) return rows(call.token === PERSON ? personRows : []);
    }
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === '/Shared/inspire/dbx_inspire_ai_agent') {
      return [200, { object_type: 'NOTEBOOK', path: url.searchParams.get('path') }];
    }
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    return null;
  };
}

async function launchWith(personRows) {
  const live = { appReads: false, grants: [] };
  const workspace = await fakeWorkspace(workspaceFor(personRows, live));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    const resp = await fetch(`${inspire.url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders' } }) });
    return { status: resp.status, data: await resp.json(), live, calls: workspace.calls };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('Discover checks the App can read the picked tables and grants with the person sign-in when the person can', async () => {
  const got = await launchWith(OWNS);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.live.grants.map(([, token]) => token), [PERSON, PERSON, PERSON], 'every grant runs with the person sign-in, never the App');
  assert.ok(got.live.grants.some(([sql]) => sql === 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `sp-app-id`'));
  assert.ok(got.live.grants.some(([sql]) => sql === 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-app-id`'), JSON.stringify(got.live.grants));
  assert.equal(got.live.appReads, true);
  const access = got.data.warnings.filter((w) => w.includes('main.s.orders'));
  assert.equal(access.length, 1, JSON.stringify(got.data.warnings));
  assert.match(access[0], /^Inspire granted the App read on main\.s\.orders with your sign-in, because Discover runs as the App: GRANT/);
  assert.ok(got.calls.some((c) => c.token === SP_TOKEN && /LIMIT 0/.test(String(c.body && c.body.statement))), 'the read probe runs as the App');
});

test('Discover warns clearly, grants nothing and still starts when neither the App can read nor the person can grant', async () => {
  const got = await launchWith(READS);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.live.grants, []);
  assert.equal(got.data.run_id, '99');
  const access = got.data.warnings.filter((w) => w.includes('main.s.orders'));
  assert.equal(access.length, 1, JSON.stringify(got.data.warnings));
  assert.match(access[0], /^Discover cannot read main\.s\.orders: Discover runs as the App service principal inspire-app \(application id sp-app-id\)/);
  assert.match(access[0], /Ask the owner to run: GRANT .*TO `sp-app-id`/);
  assert.match(access[0], /no use case is checked against that table's data$/);
});
