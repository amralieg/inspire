// c23 security batch: a fake workspace plus the real server process for the Discover launch gate (SEC-02, SEC-03, SEC-06).
// Options of launch(): tables (what the App lists under the picked schema), personProbe ('ok' | 'denied' | 'warehouse'), deniedTables (names the
// person cannot read), browseTables (names the person may list), policied (tables with a row filter), headers, scope.
const { fakeWorkspace, startInspire } = require('./serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh' };
const SIGNED_IN = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const JOB = /^\/api\/2\.[0-9]\/jobs\/(create|run-now|runs\/submit)$/;
const rows = (list) => {
  const keys = Object.keys(list[0] || { x: 1 });
  return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: keys.map((name) => ({ name })) } },
    result: { data_array: list.map((r) => keys.map((k) => r[k])) } }];
};
const DENIED = (name) => [400, { status: { state: 'FAILED', error: { message: `[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table '${name}'.` } } }];
const plain = (sql) => sql.replace(/`/g, '');

function workspaceFor(opts, live) {
  const names = opts.tables;
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    const sql = String((call.body && call.body.statement) || '');
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) {
      return [200, call.token === SP_TOKEN ? { userName: 'sp-app-id', applicationId: 'sp-app-id', displayName: 'inspire-app' } : { userName: PERSON_EMAIL }];
    }
    const eff = url.pathname.match(/^\/api\/2\.1\/unity-catalog\/effective-permissions\/(catalog|schema|table)\/(.+)$/);
    if (eff) return [200, { privilege_assignments: [{ principal: 'sp-app-id', privileges: ['USE_CATALOG', 'USE_SCHEMA', 'SELECT'].map((privilege) => ({ privilege })) }] }];
    const policy = url.pathname.match(/^\/api\/2\.1\/unity-catalog\/policies\/table\/(.+)$/);
    if (policy) {
      return (opts.policied || []).includes(decodeURIComponent(policy[1])) ? [200, { policies: [{ policy_type: 'POLICY_TYPE_ROW_FILTER' }] }] : [404, {}];
    }
    const one = url.pathname.match(/^\/api\/2\.1\/unity-catalog\/tables\/([^/]+)$/);
    if (one) {
      const name = decodeURIComponent(one[1]);
      if (call.token === PERSON) {
        live.personGets.push(name);
        if (!(opts.browseTables || names).includes(name)) return [403, { error_code: 'PERMISSION_DENIED', message: `no BROWSE on ${name}` }];
      }
      return [200, { full_name: name }];
    }
    if (url.pathname === '/api/2.0/sql/statements') {
      if (/LIMIT 0/.test(sql)) {
        if (call.token === SP_TOKEN) return rows([]);
        if (opts.personProbe === 'warehouse') return [400, { status: { state: 'FAILED', error: { message: 'PERMISSION_DENIED: User does not have CAN_USE on warehouse wh.' } } }];
        const hit = (opts.deniedTables || []).find((t) => plain(sql).includes(t));
        if (opts.personProbe === 'denied' && hit) return DENIED(hit);
        return rows([]);
      }
      if (/information_schema/.test(sql)) return rows([]);
    }
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === '/Shared/inspire/dbx_inspire_ai_agent') {
      return [200, { object_type: 'NOTEBOOK', path: url.searchParams.get('path') }];
    }
    if (url.pathname === '/api/2.1/unity-catalog/schemas') return [200, { schemas: [{ name: 's', catalog_name: 'main' }] }];
    if (url.pathname === '/api/2.1/unity-catalog/tables') {
      return [200, { tables: names.map((full) => { const [catalog_name, schema_name, name] = full.split('.'); return { name, schema_name, catalog_name, table_type: 'MANAGED' }; }) }];
    }
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
    if (url.pathname === '/api/2.1/jobs/run-now' || url.pathname === '/api/2.1/jobs/runs/submit') return [200, { run_id: 99 }];
    return null;
  };
}

async function launch(opts = {}) {
  const o = { tables: ['main.s.orders'], personProbe: 'ok', headers: SIGNED_IN, scope: 'main.s.orders', ...opts };
  const live = { personGets: [] };
  const workspace = await fakeWorkspace(workspaceFor(o, live));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    const resp = await fetch(`${inspire.url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...o.headers },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': o.scope } }) });
    const calls = workspace.calls;
    const data = await resp.json();
    return { status: resp.status, data, text: JSON.stringify(data), calls, live,
      jobs: calls.filter((c) => JOB.test(new URL(`http://x${c.path}`).pathname)) };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

module.exports = { launch, SIGNED_IN, PERSON_EMAIL };
