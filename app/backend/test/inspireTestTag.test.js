const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeInspireNotebookJobParams, buildDemoInspireDiscoveryParams, inspireJobTags, withInspireInstallParams, INSPIRE_TEST_TAG }
  = require('../lib/inspireJobParams');
const { rerunParams } = require('../lib/inspireImplement');
const { triggerDemoDataPipeline } = require('../lib/demoDataPipeline');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const NOTEBOOK = '/Shared/inspire/dbx_inspire_ai_agent';

function withTestTag(value, run) {
  const saved = process.env.INSPIRE_TEST_TAG;
  if (value === undefined) delete process.env.INSPIRE_TEST_TAG;
  else process.env.INSPIRE_TEST_TAG = value;
  return Promise.resolve().then(run).finally(() => {
    if (saved === undefined) delete process.env.INSPIRE_TEST_TAG;
    else process.env.INSPIRE_TEST_TAG = saved;
  });
}

test('a test install tags every job and passes the tag to the agent as a parameter', async () => {
  assert.equal(INSPIRE_TEST_TAG, 'dbx_inspire_ai_test');
  await withTestTag(' inspire-rc0 ', () => {
    for (const runType of ['discovery', 'implement', 'genie_regen', 'demo_pipeline']) {
      assert.equal(inspireJobTags({ runType })[INSPIRE_TEST_TAG], 'inspire-rc0', runType);
    }
    assert.equal(sanitizeInspireNotebookJobParams({ '00_business_name': 'Acme' })[INSPIRE_TEST_TAG], 'inspire-rc0');
    assert.equal(buildDemoInspireDiscoveryParams({ inspireDatabase: 'main._inspire', sessionId: '42' })[INSPIRE_TEST_TAG], 'inspire-rc0');
    assert.equal(rerunParams(['top_k'], {})[INSPIRE_TEST_TAG], 'inspire-rc0');
    assert.equal(withInspireInstallParams({ [INSPIRE_TEST_TAG]: 'other' })[INSPIRE_TEST_TAG], 'inspire-rc0');
  });
  await withTestTag('rc 0/x', () => assert.equal(inspireJobTags({ runType: 'discovery' })[INSPIRE_TEST_TAG], 'rc_0_x'));
});

test('a production install carries no test tag, even when a request sends one', async () => {
  for (const value of [undefined, '', '   ', '___']) {
    await withTestTag(value, () => {
      for (const runType of ['discovery', 'implement', 'genie_regen', 'demo_pipeline']) {
        assert.equal(INSPIRE_TEST_TAG in inspireJobTags({ runType }), false, `${runType} ${JSON.stringify(value)}`);
      }
      assert.equal(INSPIRE_TEST_TAG in sanitizeInspireNotebookJobParams({ '00_business_name': 'Acme', [INSPIRE_TEST_TAG]: 'x' }), false);
      assert.equal(INSPIRE_TEST_TAG in buildDemoInspireDiscoveryParams({ inspireDatabase: 'main._inspire', sessionId: '42' }), false);
      assert.equal(INSPIRE_TEST_TAG in rerunParams(['top_k', INSPIRE_TEST_TAG], { [INSPIRE_TEST_TAG]: 'x' }), false);
      assert.deepEqual(withInspireInstallParams({ [INSPIRE_TEST_TAG]: 'x' }), {});
    });
  }
});

test('the demo pipeline job and its Inspire task carry the test tag', async () => {
  for (const value of ['inspire-rc0', undefined]) {
    await withTestTag(value, async () => {
      const created = [];
      const fetcher = async (host, token, url, opts = {}) => {
        if (url === '/api/2.0/clusters/list') return { ok: true, json: async () => ({ clusters: [] }) };
        if (url === '/api/2.1/jobs/create') {
          created.push(JSON.parse(opts.body));
          return { ok: true, json: async () => ({ job_id: 7 }) };
        }
        if (url === '/api/2.1/jobs/run-now') return { ok: true, json: async () => ({ run_id: 9 }) };
        throw new Error(`unexpected call ${url}`);
      };
      await triggerDemoDataPipeline(fetcher, () => 'https://h/run', 'https://h', 't', {
        description: 'A retailer with stores', businessName: 'Acme Retail', inspireDatabase: 'main._inspire', sessionId: '42',
        cluster_id: '', resolveWorkspaceNotebookObjectPath: async (host, token, p) => p,
      });
      const [inspire] = created[0].tasks.filter((task) => task.task_key === 'inspire_discovery');
      assert.equal(created[0].tags[INSPIRE_TEST_TAG], value);
      assert.equal(inspire.notebook_task.base_parameters[INSPIRE_TEST_TAG], value);
    });
  }
});

async function launchRun(env) {
  const person = 'person-token';
  const workspace = await fakeWorkspace((call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
    if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: ['pat', 'example.com'].join('@') }];
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: 'main.s.orders' }];
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === NOTEBOOK) return [200, { object_type: 'NOTEBOOK', path: NOTEBOOK }];
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    return null;
  });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: NOTEBOOK, NODE_ENV: 'production',
      DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', ...env });
    const resp = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': person, 'x-forwarded-email': ['pat', 'example.com'].join('@') },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders',
        [INSPIRE_TEST_TAG]: 'from-the-request' } }),
    });
    return { status: resp.status, text: await resp.text(), created: workspace.calls.filter((call) => call.path === '/api/2.1/jobs/create') };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('a run the App of a test install launches carries the test tag the installer wrote to app.yaml', async () => {
  const run = await launchRun({ INSPIRE_TEST_TAG: 'inspire-rc0' });
  assert.equal(run.status, 200, run.text);
  const [job] = run.created.map((call) => call.body);
  assert.equal(job.tags[INSPIRE_TEST_TAG], 'inspire-rc0');
  assert.equal(job.tasks[0].notebook_task.base_parameters[INSPIRE_TEST_TAG], 'inspire-rc0');
});

test('a run the App of a production install launches carries no test tag, even when the request sends one', async () => {
  const run = await launchRun({});
  assert.equal(run.status, 200, run.text);
  const [job] = run.created.map((call) => call.body);
  assert.equal(INSPIRE_TEST_TAG in job.tags, false);
  assert.equal(INSPIRE_TEST_TAG in job.tasks[0].notebook_task.base_parameters, false);
});
