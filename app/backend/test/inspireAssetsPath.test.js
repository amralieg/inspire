const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeInspireNotebookJobParams, buildDemoInspireDiscoveryParams, INSPIRE_ASSETS_PARAM, withInspireAssetsPath } = require('../lib/inspireJobParams');
const { rerunParams } = require('../lib/inspireImplement');
const { triggerDemoDataPipeline } = require('../lib/demoDataPipeline');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const ASSETS = '/Workspace/Shared/inspire-ai/assets/v1.3.0';
const NOTEBOOK = '/Shared/inspire/dbx_inspire_ai_agent';

function withAssets(value, run) {
  const saved = process.env.INSPIRE_ASSETS_PATH;
  if (value === undefined) delete process.env.INSPIRE_ASSETS_PATH;
  else process.env.INSPIRE_ASSETS_PATH = value;
  return Promise.resolve().then(run).finally(() => {
    if (saved === undefined) delete process.env.INSPIRE_ASSETS_PATH;
    else process.env.INSPIRE_ASSETS_PATH = saved;
  });
}

test('the agent job parameters carry the installed assets path from INSPIRE_ASSETS_PATH, and never a path a request sends', async () => {
  assert.equal(INSPIRE_ASSETS_PARAM, 'inspire_assets_path');
  await withAssets(` ${ASSETS} `, () => {
    assert.equal(sanitizeInspireNotebookJobParams({ '00_business_name': 'Acme' }).inspire_assets_path, ASSETS);
    assert.equal(sanitizeInspireNotebookJobParams({ '00_business_name': 'Acme', inspire_assets_path: '/Users/x/evil' }).inspire_assets_path, ASSETS);
    assert.equal(buildDemoInspireDiscoveryParams({ inspireDatabase: 'main._inspire', sessionId: '42' }).inspire_assets_path, ASSETS);
  });
  await withAssets(undefined, () => {
    assert.equal('inspire_assets_path' in sanitizeInspireNotebookJobParams({ '00_business_name': 'Acme', inspire_assets_path: '/Users/x/evil' }), false);
  });
});

test('a new launch and a re-run take the assets path from the one helper, and a request never sets it', async () => {
  await withAssets(ASSETS, () => {
    assert.deepEqual(withInspireAssetsPath({ top_k: '3', inspire_assets_path: '/Users/x/evil' }), { top_k: '3', inspire_assets_path: ASSETS });
    assert.deepEqual(rerunParams(['top_k', 'inspire_assets_path'], { top_k: '3', inspire_assets_path: '/Users/x/evil' }),
      { top_k: '3', run_profile: 'preview', inspire_assets_path: ASSETS });
    assert.deepEqual(rerunParams(['top_k'], {}), { run_profile: 'preview', inspire_assets_path: ASSETS });
  });
  await withAssets(undefined, () => {
    assert.deepEqual(rerunParams(['top_k', 'inspire_assets_path'], { inspire_assets_path: '/Users/x/evil' }), { run_profile: 'preview' });
    assert.deepEqual(withInspireAssetsPath({ inspire_assets_path: '/Users/x/evil' }), {});
  });
});

test('the demo pipeline passes the assets path to its Inspire task', async () => {
  await withAssets(ASSETS, async () => {
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
    assert.equal(inspire.notebook_task.base_parameters.inspire_assets_path, ASSETS);
  });
});

async function launchRun(folders) {
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
  }, folders ? { folders } : {});
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: NOTEBOOK, NODE_ENV: 'production',
      DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_ASSETS_PATH: ASSETS });
    const resp = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': person, 'x-forwarded-email': ['pat', 'example.com'].join('@') },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders' } }),
    });
    return { status: resp.status, text: await resp.text(), created: workspace.calls.filter((call) => call.path === '/api/2.1/jobs/create') };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('a run the App launches passes the assets path the installer wrote to app.yaml, the way it passes NOTEBOOK_PATH', async () => {
  const run = await launchRun();
  assert.equal(run.status, 200, run.text);
  const [task] = run.created[0].body.tasks;
  assert.equal(task.notebook_task.notebook_path, NOTEBOOK);
  assert.equal(task.notebook_task.base_parameters.inspire_assets_path, ASSETS);
});

test('a run whose output folder the person cannot write is refused with 403 and creates no job', async () => {
  const run = await launchRun({ '/Shared': { writers: [] } });
  assert.equal(run.status, 403, run.text);
  assert.match(run.text, /cannot write to \/Shared\/demos/);
  assert.deepEqual(run.created, []);
});
