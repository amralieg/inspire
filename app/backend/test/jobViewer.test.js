const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { JOB_VIEW_LEVEL, NO_LAUNCHER_VIEW, grantJobViewer } = require('../lib/jobViewer');
const { triggerDemoDataPipeline } = require('../lib/demoDataPipeline');

const PERSON = ['pat.lee', 'example.com'].join('@');
const NOTEBOOK = '/Workspace/Shared/inspire_ai/dbx_inspire_ai_agent';

function recorder(answer = () => [200, {}]) {
  const calls = [];
  const fetcher = async (host, token, url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const [status, data] = answer(url, opts);
    return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
  };
  return { calls, fetcher };
}

test('the launcher is given CAN_VIEW on the job through the permissions API, and only that one person', async () => {
  const { calls, fetcher } = recorder();
  assert.deepEqual(await grantJobViewer(fetcher, 'h', 't', 2222222222222222222n, PERSON), { granted: true, note: '' });
  assert.deepEqual(calls, [{ url: '/api/2.0/permissions/jobs/2222222222222222222', method: 'PATCH',
    body: { access_control_list: [{ user_name: PERSON, permission_level: 'CAN_VIEW' }] } }]);
  assert.equal(JOB_VIEW_LEVEL, 'CAN_VIEW', 'view only: CAN_MANAGE_RUN would let the person start the job as the App');
  const named = recorder();
  await grantJobViewer(named.fetcher, 'h', 't', '7', { username: ` ${PERSON} ` });
  assert.equal(named.calls[0].body.access_control_list[0].user_name, PERSON);
});

test('no signed-in person means no grant call and a plain note (must-exclude)', async () => {
  for (const nobody of ['', '   ', null, undefined, { username: '' }]) {
    const { calls, fetcher } = recorder();
    assert.deepEqual(await grantJobViewer(fetcher, 'h', 't', '7', nobody), { granted: false, note: NO_LAUNCHER_VIEW });
    assert.equal(calls.length, 0, String(nobody));
  }
  const { calls, fetcher } = recorder();
  const bad = await grantJobViewer(fetcher, 'h', 't', 'abc', PERSON);
  assert.equal(bad.granted, false);
  assert.equal(calls.length, 0);
});

test('a refused or failed grant never throws and says why in one sentence', async () => {
  const refused = recorder(() => [403, { error_code: 'PERMISSION_DENIED', message: 'not allowed to change permissions' }]);
  const out = await grantJobViewer(refused.fetcher, 'h', 't', '7', PERSON);
  assert.deepEqual(out, { granted: false, note: `Inspire could not let ${PERSON} view job 7 in Databricks: not allowed to change permissions` });
  const broken = await grantJobViewer(async () => { throw new Error('socket hang up'); }, 'h', 't', '7', PERSON);
  assert.equal(broken.note, `Inspire could not let ${PERSON} view job 7 in Databricks: socket hang up`);
});

async function launch(grantAnswer) {
  const workspace = await fakeWorkspace((call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
    if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: PERSON }];
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: 'main.s.orders' }];
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === NOTEBOOK) return [200, { object_type: 'NOTEBOOK', path: NOTEBOOK }];
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 1111111111111111 }];
    if (url.pathname === '/api/2.0/permissions/jobs/1111111111111111') return grantAnswer;
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    return null;
  });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: NOTEBOOK, NODE_ENV: 'production',
      DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' });
    const resp = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders' } }),
    });
    const paths = workspace.calls.map((c) => `${c.method} ${c.path.split('?')[0]}`);
    return { status: resp.status, body: await resp.json(), paths, grants: workspace.calls.filter((c) => c.path.startsWith('/api/2.0/permissions/jobs/')) };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('a run launched from the App gives the person who launched it view on its job before the run starts', async () => {
  const run = await launch([200, {}]);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.grants.length, 1);
  assert.equal(run.grants[0].method, 'PATCH');
  assert.deepEqual(run.grants[0].body, { access_control_list: [{ user_name: PERSON, permission_level: 'CAN_VIEW' }] });
  const at = (p) => run.paths.indexOf(p);
  assert.ok(at('POST /api/2.1/jobs/create') < at('PATCH /api/2.0/permissions/jobs/1111111111111111'));
  assert.ok(at('PATCH /api/2.0/permissions/jobs/1111111111111111') < at('POST /api/2.1/jobs/run-now'));
  assert.equal(run.body.viewer_granted, true);
  assert.equal(run.body.viewer_note, undefined);
});

test('a refused grant still starts the run and tells the caller why', async () => {
  const run = await launch([403, { message: 'no CAN_MANAGE on job' }]);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.run_id, 99);
  assert.equal(run.body.viewer_granted, false);
  assert.equal(run.body.viewer_note, `Inspire could not let ${PERSON} view job 1111111111111111 in Databricks: no CAN_MANAGE on job`);
});

test('the demo-data pipeline job gives its launcher view too', async () => {
  const { calls, fetcher } = recorder((url) => {
    if (url === '/api/2.1/jobs/create') return [200, { job_id: 31 }];
    if (url === '/api/2.1/jobs/run-now') return [200, { run_id: 32 }];
    return [200, {}];
  });
  const out = await triggerDemoDataPipeline(fetcher, () => 'https://h/run', 'https://h', 't', {
    description: 'A retailer with stores', businessName: 'Acme Retail', inspireDatabase: 'main._inspire', sessionId: '42',
    cluster_id: '', resolveWorkspaceNotebookObjectPath: async (host, token, p) => p, launchedBy: PERSON,
  });
  const grant = calls.find((c) => c.url === '/api/2.0/permissions/jobs/31');
  assert.ok(grant, calls.map((c) => c.url).join(' '));
  assert.deepEqual(grant.body.access_control_list, [{ user_name: PERSON, permission_level: 'CAN_VIEW' }]);
  assert.equal(out.viewer_granted, true);
});

test('every place the App creates or starts a job grants its launcher view through grantJobViewer', () => {
  const backend = path.join(__dirname, '..');
  const sources = ['server.js', 'implementRoutes.js', ...fs.readdirSync(path.join(backend, 'lib')).map((n) => path.join('lib', n))]
    .map((rel) => [rel, fs.readFileSync(path.join(backend, rel), 'utf8')]);
  const starters = sources.filter(([, text]) => /'\/api\/2\.1\/jobs\/(create|run-now)'|'\/api\/2\.\d\/jobs\/runs\/submit'/.test(text));
  assert.deepEqual(starters.map(([rel]) => rel).sort(), ['implementRoutes.js', path.join('lib', 'demoDataPipeline.js'), 'server.js'].sort());
  for (const [rel, text] of starters) {
    const starts = (text.match(/'\/api\/2\.1\/jobs\/run-now'/g) || []).length;
    const grants = (text.match(/await grantJobViewer\(/g) || []).length;
    assert.equal(grants, starts, `${rel}: ${starts} job starts, ${grants} viewer grants`);
  }
});
