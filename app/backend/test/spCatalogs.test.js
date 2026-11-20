// REQ-420 (D-SL-13): Start lists the catalogs the App's service principal can read now, not the installer's pick, and a run never
// starts on a catalog it can no longer read.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const SP_ID = 'inspire-client';
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: SP_ID, DATABRICKS_CLIENT_SECRET: 'inspire-secret' };
// The person sees four catalogs. The App's principal reads `main`, holds only USE CATALOG on `half`, and sees nothing of `hr` or `dropped`.
const PERSON_SEES = ['main', 'half', 'hr', 'dropped'];
const SP_SEES = ['main', 'half'];
const HELD = { main: ['USE_CATALOG', 'SELECT', 'READ_METADATA'], half: ['USE_CATALOG'] };
const JOBS = (workspace) => workspace.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));

function answer(call) {
  const url = new URL(`http://x${call.path}`);
  if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, call.token === SP_TOKEN ? { userName: SP_ID, applicationId: SP_ID } : { userName: PERSON_EMAIL }];
  if (url.pathname === '/api/2.1/unity-catalog/catalogs') {
    return [200, { catalogs: (call.token === SP_TOKEN ? SP_SEES : PERSON_SEES).map((name) => ({ name })) }];
  }
  const eff = /^\/api\/2\.1\/unity-catalog\/effective-permissions\/catalog\/([^/]+)$/.exec(url.pathname);
  if (eff) {
    return [200, { privilege_assignments: [{ principal: SP_ID, privileges: (HELD[decodeURIComponent(eff[1])] || []).map((privilege) => ({ privilege })) }] }];
  }
  const one = /^\/api\/2\.1\/unity-catalog\/tables\/(.+)$/.exec(url.pathname);
  if (one) return [200, { full_name: decodeURIComponent(one[1]) }];
  if (url.pathname === '/api/2.1/unity-catalog/tables') return [200, { tables: [{ name: 'orders', full_name: 'main.s.orders' }] }];
  if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === '/Shared/inspire/dbx_inspire_ai_agent') {
    return [200, { object_type: 'NOTEBOOK', path: url.searchParams.get('path') }];
  }
  if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
  if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
  return null;
}

async function withInspire(run, env = {}) {
  const workspace = await fakeWorkspace(answer);
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV, ...env });
    await run(inspire.url, workspace);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}
const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const launch = async (url, scope) => {
  const resp = await fetch(`${url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn },
    body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '11_generation_path': '/Shared/demos', '01_uc_metadata': scope } }) });
  return { status: resp.status, data: await resp.json() };
};

test('the catalog list is the catalogs the App principal can read now, partial ones carry their missing GRANT lines, and the installer pick is ignored (REQ-420)', async () => {
  await withInspire(async (url) => {
    const got = await (await fetch(`${url}/api/catalogs?warehouse_id=wh`, { headers: signedIn })).json();
    assert.deepEqual(got.catalogs.map((c) => c.name), ['half', 'main'], 'exactly the granted catalogs; hr (person only) and dropped (installer pick only) are not listed');
    assert.equal(got.spGrants, true);
    const half = got.catalogs.find((c) => c.name === 'half');
    assert.deepEqual(half.partial.missing, [`GRANT SELECT ON CATALOG \`half\` TO \`${SP_ID}\``, `GRANT READ METADATA ON CATALOG \`half\` TO \`${SP_ID}\``]);
    assert.equal(got.catalogs.find((c) => c.name === 'main').partial, undefined, 'a fully granted catalog carries no flag (must-keep)');
    assert.deepEqual(got.permissions.map((p) => p.statements), [half.partial.missing], 'the Permission Required entry names the same lines');
  }, { INSPIRE_DATA_CATALOGS: '["main","dropped"]' });
});

test('a run is refused with a plain message when its scope names a catalog the App can no longer read, and nothing is created (REQ-420)', async () => {
  await withInspire(async (url, workspace) => {
    for (const scope of ['dropped', 'hr.p.salaries', 'main.s.orders,dropped.s.t']) {
      const refused = await launch(url, scope);
      assert.equal(refused.status, 403, `${scope}: ${JSON.stringify(refused.data)}`);
      assert.match(refused.data.error, /can no longer read .*(dropped|hr)/, scope);
      assert.deepEqual(JOBS(workspace), [], 'no job is created');
    }
    const ok = await launch(url, 'main.s.orders');
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(JOBS(workspace).length, 2, 'a readable catalog still starts the run (must-keep)');
  });
});
