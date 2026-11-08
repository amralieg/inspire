const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fileNames } = require('./support/sourceFiles');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { JOB_VIEW_LEVEL, NO_LAUNCHER_VIEW, REMEMBERED_RUNS, grantJobViewer, rememberViewer, viewerNoteOf } = require('../lib/jobViewer');
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
  assert.deepEqual(calls, [{ url: '/api/2.0/permissions/jobs/2222222222222222222', method: 'GET', body: null },
    { url: '/api/2.0/permissions/jobs/2222222222222222222', method: 'PATCH', body: { access_control_list: [{ user_name: PERSON, permission_level: 'CAN_VIEW' }] } }]);
  assert.equal(JOB_VIEW_LEVEL, 'CAN_VIEW', 'view only: CAN_MANAGE_RUN would let the person start the job as the App');
  const named = recorder();
  await grantJobViewer(named.fetcher, 'h', 't', '7', { username: ` ${PERSON} ` });
  assert.equal(named.calls.find((c) => c.method === 'PATCH').body.access_control_list[0].user_name, PERSON);
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

const acl = (entries) => [200, { object_id: '/jobs/7', access_control_list: entries }];
const held = (user, level, inherited = false) => ({ user_name: user, all_permissions: [{ permission_level: level, inherited }] });

test('a launcher who already owns or can view the job gets no grant call and no note', async () => {
  for (const level of ['IS_OWNER', 'CAN_MANAGE', 'CAN_MANAGE_RUN', 'CAN_VIEW']) {
    for (const user of [PERSON, PERSON.toUpperCase()]) {
      const { calls, fetcher } = recorder((url, opts) => (opts.method === 'PATCH' ? [500, {}] : acl([held('someone@example.com', 'CAN_VIEW'), held(user, level, level === 'CAN_VIEW')])));
      assert.deepEqual(await grantJobViewer(fetcher, 'h', 't', '7', PERSON), { granted: true, note: '', already: true }, `${level} ${user}`);
      assert.deepEqual(calls.map((c) => c.method), ['GET'], `${level} ${user}`);
    }
  }
});

test('the grant is still made when someone else owns the job, the launcher holds no level, or the permissions cannot be read (must-exclude)', async () => {
  const cases = [acl([held('owner@example.com', 'IS_OWNER')]), acl([{ user_name: PERSON, all_permissions: [] }]), acl([{ group_name: PERSON, all_permissions: [{ permission_level: 'CAN_VIEW' }] }]),
    acl([held(PERSON, 'CAN_NOTHING')]), [403, { message: 'no' }], [200, 'not json'], [200, {}]];
  for (const answer of cases) {
    const { calls, fetcher } = recorder((url, opts) => (opts.method === 'PATCH' ? [200, {}] : answer));
    assert.deepEqual(await grantJobViewer(fetcher, 'h', 't', '7', PERSON), { granted: true, note: '' }, JSON.stringify(answer));
    assert.deepEqual(calls.map((c) => c.method), ['GET', 'PATCH'], JSON.stringify(answer));
  }
});

test('a run remembers only a refusal note, forgets it when a later grant works, and keeps at most the newest runs', () => {
  rememberViewer('5000000000000000001', { granted: false, note: 'refused' });
  assert.equal(viewerNoteOf('5000000000000000001'), 'refused');
  assert.equal(viewerNoteOf(5000000000000000001n), 'refused');
  rememberViewer('5000000000000000001', { granted: true, note: '' });
  assert.equal(viewerNoteOf('5000000000000000001'), '');
  assert.equal(viewerNoteOf('abc'), '');
  rememberViewer('abc', { note: 'x' });
  for (let i = 0; i <= REMEMBERED_RUNS; i += 1) rememberViewer(String(6000000 + i), { note: `n${i}` });
  assert.equal(viewerNoteOf('6000000'), '', 'the oldest note is dropped');
  assert.equal(viewerNoteOf(String(6000000 + REMEMBERED_RUNS)), `n${REMEMBERED_RUNS}`);
});

async function launch(grantAnswer, aclAnswer = [200, {}]) {
  const workspace = await fakeWorkspace((call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
    if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: PERSON }];
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: 'main.s.orders' }];
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === NOTEBOOK) return [200, { object_type: 'NOTEBOOK', path: NOTEBOOK }];
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 1111111111111111 }];
    if (url.pathname === '/api/2.0/permissions/jobs/1111111111111111') return call.method === 'GET' ? aclAnswer : grantAnswer;
    if (url.pathname === '/api/2.0/sql/statements') {
      const launcher = /^SELECT launched_by FROM/.test(String(call.body?.statement || ''));
      return [200, { statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'launched_by' }] } }, result: { data_array: launcher ? [[PERSON]] : [] } }];
    }
    if (url.pathname === '/api/2.1/jobs/runs/get') return [200, { run_id: 99, run_name: 'Inspire AI - Acme', state: { life_cycle_state: 'RUNNING' } }];
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    return null;
  });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: NOTEBOOK, NODE_ENV: 'production', INSPIRE_WAREHOUSE_ID: 'w1', INSPIRE_DATABASE: 'main._inspire',
      DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' });
    const resp = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders' } }),
    });
    const body = await resp.json();
    const read = await fetch(`${inspire.url}/api/run/99`, { headers: { 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON } });
    const paths = workspace.calls.map((c) => `${c.method} ${c.path.split('?')[0]}`);
    return { status: resp.status, body, run: await read.json(), paths,
      grants: workspace.calls.filter((c) => c.path.startsWith('/api/2.0/permissions/jobs/') && c.method === 'PATCH') };
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
  assert.equal(run.run.run_id, 99, JSON.stringify(run.run));
  assert.equal(Object.hasOwn(run.run, 'viewer_note'), false, 'the Monitor read carries no note when the grant worked');
});

test('a run launched with the person\u2019s own token, so they own the job, makes no grant call and shows no note', async () => {
  const run = await launch([500, { message: 'must not be called' }], acl([held(PERSON, 'IS_OWNER')]));
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.grants.length, 0);
  assert.equal(run.body.viewer_granted, true);
  assert.equal(run.body.viewer_note, undefined);
  assert.equal(Object.hasOwn(run.run, 'viewer_note'), false);
});

test('a refused grant still starts the run and tells the caller why', async () => {
  const run = await launch([403, { message: 'no CAN_MANAGE on job' }]);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.run_id, '99');
  assert.equal(run.body.viewer_granted, false);
  assert.equal(run.body.viewer_note, `Inspire could not let ${PERSON} view job 1111111111111111 in Databricks: no CAN_MANAGE on job`);
  assert.equal(run.run.viewer_note, run.body.viewer_note, 'the Monitor read of the run carries the same note, so the refusal is never silent');
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
  const grant = calls.find((c) => c.url === '/api/2.0/permissions/jobs/31' && c.method === 'PATCH');
  assert.ok(grant, calls.map((c) => c.url).join(' '));
  assert.deepEqual(grant.body.access_control_list, [{ user_name: PERSON, permission_level: 'CAN_VIEW' }]);
  assert.equal(out.viewer_granted, true);
});

test('every place the App creates or starts a job grants its launcher view through grantJobViewer', () => {
  const backend = path.join(__dirname, '..');
  const sources = ['server.js', 'implementRoutes.js', ...fileNames(path.join(backend, 'lib')).map((n) => path.join('lib', n))]
    .map((rel) => [rel, fs.readFileSync(path.join(backend, rel), 'utf8')]);
  const starters = sources.filter(([, text]) => /'\/api\/2\.1\/jobs\/(create|run-now)'|'\/api\/2\.\d\/jobs\/runs\/submit'/.test(text));
  assert.deepEqual(starters.map(([rel]) => rel).sort(), ['implementRoutes.js', path.join('lib', 'demoDataPipeline.js'), 'server.js'].sort());
  for (const [rel, text] of starters) {
    const starts = (text.match(/'\/api\/2\.1\/jobs\/run-now'/g) || []).length;
    const grants = (text.match(/await grantJobViewer\(/g) || []).length;
    assert.equal(grants, starts, `${rel}: ${starts} job starts, ${grants} viewer grants`);
    assert.equal((text.match(/rememberViewer\((runId|data\.run_id), viewer\)/g) || []).length, starts, `${rel}: every started run keeps its viewer note for the Monitor`);
  }
});
