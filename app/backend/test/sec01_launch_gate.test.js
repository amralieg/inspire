// SEC-01 AT3 (W1, D2), AT6 (W5) and AT7 (W2): the Discover launch gate, against a fake workspace run by the real server process.
// The job trigger (triggerInspireNotebookJob) is observed as calls to the Jobs API: jobs/create, jobs/run-now or jobs/runs/submit.
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
// The launcher owns the catalog of the picked table, so today Discover grants the App read access with the launcher's sign-in.
const OWNS = [
  { level: 'catalog', privilege: 'OWNER', principal: PERSON_EMAIL, mine: 'true', me: PERSON_EMAIL },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: PERSON_EMAIL },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
];
const READ_ONLY_HELD = ['USE_CATALOG', 'USE_SCHEMA', 'SELECT', 'BROWSE', 'READ_METADATA'];
const JOB = /^\/api\/2\.[0-9]\/jobs\/(create|run-now|runs\/submit)$/;

// live: { appReads, personReads, held: { 'schema/main.s': ['MODIFY'] }, grants: [] }
function workspaceFor(live) {
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    const sql = String((call.body && call.body.statement) || '');
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) {
      return [200, call.token === SP_TOKEN ? { userName: 'sp-app-id', applicationId: 'sp-app-id', displayName: 'inspire-app' } : { userName: PERSON_EMAIL }];
    }
    // W2: the SP's effective permissions on each securable (spCatalogs.js heldOn reads privilege_assignments[].privileges[].privilege).
    const eff = url.pathname.match(/^\/api\/2\.1\/unity-catalog\/effective-permissions\/(catalog|schema|table)\/(.+)$/);
    if (eff) {
      const key = `${eff[1]}/${decodeURIComponent(eff[2])}`;
      const held = (live.held && live.held[key]) || READ_ONLY_HELD;
      live.effective.push(key);
      return [200, { privilege_assignments: [{ principal: url.searchParams.get('principal') || 'sp-app-id', privileges: held.map((privilege) => ({ privilege })) }] }];
    }
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: decodeURIComponent(url.pathname.split('/').pop()) }];
    if (url.pathname === '/api/2.0/sql/statements') {
      if (/LIMIT 0/.test(sql)) {
        if (call.token === SP_TOKEN) return live.appReads ? rows([]) : DENIED('main.s.orders');
        return live.personReads ? rows([]) : DENIED('main.s.orders');
      }
      if (/^\s*GRANT /i.test(sql)) {
        live.grants.push([sql, call.token]);
        if (call.token === PERSON && sql.includes('`sp-app-id`')) live.appReads = true;
        return rows([]);
      }
      if (/information_schema/.test(sql)) return rows(call.token === PERSON ? OWNS : []);
    }
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === '/Shared/inspire/dbx_inspire_ai_agent') {
      return [200, { object_type: 'NOTEBOOK', path: url.searchParams.get('path') }];
    }
    if (url.pathname === '/api/2.1/unity-catalog/schemas') return [200, { schemas: [{ name: 's', catalog_name: 'main' }] }];
    if (url.pathname === '/api/2.1/unity-catalog/tables') return [200, { tables: [{ name: 'orders', schema_name: 's', catalog_name: 'main', table_type: 'MANAGED' }] }];
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    if (url.pathname === '/api/2.1/jobs/runs/submit') return [200, { run_id: 99 }];
    return null;
  };
}

async function launch({ appReads = true, personReads = true, held = {} } = {}) {
  const live = { appReads, personReads, held, grants: [], effective: [] };
  const workspace = await fakeWorkspace(workspaceFor(live));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    const resp = await fetch(`${inspire.url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders' } }) });
    const calls = workspace.calls;
    return { status: resp.status, data: await resp.json(), live, calls, jobs: calls.filter((c) => JOB.test(new URL(`http://x${c.path}`).pathname)) };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}
const text = (data) => JSON.stringify(data);

test('AT3: Discover launch where the launcher owns a table the SP cannot read runs no GRANT and returns a permissions payload', async () => {
  const got = await launch({ appReads: false });
  assert.deepEqual(got.live.grants, [], 'AT3: Discover ran GRANTs with the launcher sign-in (discoverAppAccess -> runPersonGrants, server.js:2542)');
  const permissions = got.data.permissions || [];
  assert.ok(permissions.length >= 1, `AT3: the response must carry a permissions payload: ${text(got.data)}`);
  const statements = permissions.flatMap((p) => p.statements || []);
  assert.ok(statements.includes('GRANT SELECT ON TABLE `main`.`s`.`orders` TO `sp-app-id`'), `AT3: a table-level SELECT for Inspire's SP: ${text(statements)}`);
  assert.deepEqual(statements.filter((s) => /MANAGE|MODIFY|ALL PRIVILEGES/i.test(s)), [], 'AT3: read privileges only');
});

test('AT6: a read revoked between pick and launch returns 403 with the dialog payload, and no job is triggered', async () => {
  const got = await launch({ appReads: true, personReads: false });
  assert.equal(got.jobs.length, 0, `AT6: the job was triggered although the launcher can no longer read main.s.orders: ${text(got.jobs.map((c) => c.path))}`);
  assert.equal(got.status, 403, `AT6: launch must be refused with 403: ${text(got.data)}`);
  const permissions = got.data.permissions || [];
  assert.ok(permissions.length >= 1, `AT6: the 403 carries the permissions dialog payload: ${text(got.data)}`);
  assert.ok(permissions.some((p) => (p.statements || []).some((s) => /^GRANT SELECT ON TABLE `main`\.`s`\.`orders` TO /.test(s))),
    `AT6: the dialog names the table, table-level: ${text(permissions)}`);
  assert.equal(got.data.request, 'person', `AT6: the RfA is for the launcher (request: 'person'): ${text(got.data)}`);
  assert.deepEqual(got.live.grants, [], 'AT6: no grant runs');
});

test('AT6 control: when the launcher and the SP can both read, the launch starts the job', async () => {
  const got = await launch({ appReads: true, personReads: true });
  assert.equal(got.status, 200, text(got.data));
  assert.ok(got.jobs.length >= 1, 'the job is triggered');
  assert.deepEqual(got.live.grants, []);
});

test('AT7: the SP holds MODIFY on a source schema: launch is refused, no job is triggered, and the message gives REVOKE MODIFY', async () => {
  const got = await launch({ appReads: true, personReads: true, held: { 'schema/main.s': ['USE_SCHEMA', 'SELECT', 'MODIFY'] } });
  assert.equal(got.jobs.length, 0, `AT7: the job was triggered although Inspire's SP holds MODIFY on main.s (no effective-permissions guard): ${text(got.data)}`);
  assert.ok(got.status >= 400 && got.status < 500, `AT7: launch must be refused: ${got.status} ${text(got.data)}`);
  assert.match(text(got.data), /REVOKE MODIFY ON SCHEMA `?main`?\.`?s`? FROM /, `AT7: the message names the privilege and gives the exact REVOKE: ${text(got.data)}`);
  assert.ok(got.live.effective.includes('schema/main.s'), `AT7: the guard reads effective-permissions on the source schema: ${text(got.live.effective)}`);
});

test('AT7 control: a read-only SP on catalog, schema and table launches', async () => {
  const got = await launch({ appReads: true, personReads: true });
  assert.equal(got.status, 200, text(got.data));
  assert.ok(got.jobs.length >= 1);
});
