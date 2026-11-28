// REQ-586 / REQ-586a: one agent notebook becomes two. Discover and Match run inspire_discover; Implement (and its Genie regen) runs
// inspire_generate. One exported resolver, agentNotebookFor, picks the notebook; the names live in one constant, AGENT_NOTEBOOKS.
// Fail-first on the base (3397c496e). Builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const JP = require('../lib/inspireJobParams');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const BACKEND = path.join(__dirname, '..');
const FOLDER = '/Shared/inspire';
const read = (file) => fs.readFileSync(path.join(BACKEND, file), 'utf8');
const bodyOf = (src, start, end) => {
  const at = src.indexOf(start);
  assert.ok(at >= 0, `${start} exists`);
  return src.slice(at, src.indexOf(end, at + start.length));
};

test('T-NB2-01: the two notebook names live in one frozen constant', () => {
  assert.deepEqual(JP.AGENT_NOTEBOOKS, { discover: 'inspire_discover', generate: 'inspire_generate' });
  assert.ok(Object.isFrozen(JP.AGENT_NOTEBOOKS), 'AGENT_NOTEBOOKS is frozen');
});

test('T-NB2-01: agentNotebookFor routes each operation to its notebook', () => {
  assert.equal(typeof JP.agentNotebookFor, 'function', 'lib/inspireJobParams.js exports agentNotebookFor');
  const cases = [
    [{ jobType: 'discovery', operation: 'Discover Use Cases' }, 'inspire_discover'],
    [{ jobType: 'discovery', operation: '' }, 'inspire_discover'],
    [{ jobType: 'discovery', operation: 'Match Use Cases' }, 'inspire_discover'],
    [{ jobType: 'implement', operation: '' }, 'inspire_generate'],
    [{ jobType: 'genie_regen', operation: '' }, 'inspire_generate'],
  ];
  for (const [input, want] of cases) assert.equal(JP.agentNotebookFor(input), want, JSON.stringify(input));
  assert.throws(() => JP.agentNotebookFor({ jobType: 'nonsense', operation: '' }), /nonsense/);
});

test('T-NB2-01: the launch picks the notebook through agentNotebookFor, and no other site names a notebook file', () => {
  const trigger = bodyOf(read('server.js'), 'async function triggerInspireNotebookJob', "'/api/2.1/jobs/create'");
  assert.match(trigger, /agentNotebookFor\(\s*\{\s*jobType/, 'triggerInspireNotebookJob resolves the notebook with agentNotebookFor({ jobType, ... })');
  const sources = ['server.js', 'implementRoutes.js', ...fs.readdirSync(path.join(BACKEND, 'lib')).map((f) => path.join('lib', f))]
    .filter((f) => f.endsWith('.js') && f !== path.join('lib', 'inspireJobParams.js'));
  const literal = /['"`](?:[^'"`]*\/)?inspire_(?:discover|generate)['"`]/;
  assert.deepEqual(sources.filter((f) => literal.test(read(f))), [], 'only AGENT_NOTEBOOKS spells the notebook names');
});

test('T-NB2-01: the Implement rerun reuses the job Implement created (no new job, no notebook choice)', () => {
  const rerun = bodyOf(read('implementRoutes.js'), "app.post('/api/inspire/implement/rerun'", 'app.');
  assert.match(rerun, /\/api\/2\.1\/jobs\/run-now/);
  assert.doesNotMatch(rerun, /jobs\/create|notebook_path|triggerInspireNotebookJob/);
  const implement = bodyOf(read('implementRoutes.js'), 'out = await triggerInspireNotebookJob(', '});');
  assert.match(implement, /jobType: 'implement'/, 'the Implement submit is jobType implement, so it lands on inspire_generate');
});

async function launch(extraParams) {
  const workspace = await fakeWorkspace((call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
    if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: ['pat', 'example.com'].join('@') }];
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: 'main.s.orders' }];
    if (url.pathname === '/api/2.0/sql/statements') return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] } }, result: { data_array: [] } }];
    const asked = url.searchParams.get('path') || '';
    if (url.pathname === '/api/2.0/workspace/get-status' && asked.startsWith(`${FOLDER}/`)) return [200, { object_type: 'NOTEBOOK', path: asked }];
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    return null;
  });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: `${FOLDER}/dbx_inspire_ai_agent`, NODE_ENV: 'production',
      DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh', INSPIRE_TEST_TAG: '' });
    const resp = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': ['pat', 'example.com'].join('@') },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders', ...extraParams } }),
    });
    const text = await resp.text();
    assert.equal(resp.status, 200, text);
    const [job] = workspace.calls.filter((call) => call.path === '/api/2.1/jobs/create').map((call) => call.body);
    return job;
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('T-NB2-01: a Discover submit runs inspire_discover', async () => {
  const job = await launch({ '15_operation': 'Discover Use Cases' });
  assert.equal(job.tasks[0].notebook_task.notebook_path, `${FOLDER}/inspire_discover`);
  assert.equal(job.tags.dbx_inspire_ai_notebook, 'inspire_discover', 'the existing notebook tag names the notebook that ran');
});

test('T-NB2-01: a Match submit runs inspire_discover', async () => {
  const job = await launch({ '15_operation': 'Match Use Cases', '19_match_phase': 'match' });
  assert.equal(job.tasks[0].notebook_task.notebook_path, `${FOLDER}/inspire_discover`);
});
