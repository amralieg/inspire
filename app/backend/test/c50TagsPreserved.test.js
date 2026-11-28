// REQ-586a guard: the two-notebook split keeps every existing job tag key and never tags the launching person (no PII).
// Passes on the base (3397c496e) and must stay green through the split. Builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspireJobTags, INSPIRE_TEST_TAG } = require('../lib/inspireJobParams');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const PERSON = { email: 'zelda.quorn@example.com', name: 'Zelda Quorn' };
const PII = ['zelda', 'quorn', 'example.com', 'example_com'];

const BASE_KEYS = ['dbx_inspire_ai_business', 'dbx_inspire_ai_launcher_source', 'dbx_inspire_ai_notebook', 'dbx_inspire_ai_run_type',
  'dbx_inspire_ai_session', 'dbx_inspire_ai_session_id', 'dbx_inspire_ai_type', 'dbx_inspire_ai_usecases', 'dbx_inspire_ai_version', 'inspire_version'];
const SNAPSHOT = {
  discover: BASE_KEYS,
  match: BASE_KEYS,
  implement: [...BASE_KEYS, 'dbx_inspire_ai_spec_version', 'dbx_inspire_ai_usecase_id', 'dbx_inspire_ai_usecase_name'].sort(),
};

// The fake params carry the launching person everywhere a careless refactor could copy them from.
const personParams = { '14_session_id': '424242', '00_business_name': 'Acme', launched_by: PERSON.email, created_by: PERSON.email,
  user_name: PERSON.name, owner: PERSON.email };
const INPUTS = {
  discover: { runType: 'discovery', params: { ...personParams, '15_operation': 'discover' }, businessName: 'Acme', notebookFilename: 'inspire_discover' },
  match: { runType: 'discovery', params: { ...personParams, '15_operation': 'match' }, businessName: 'Acme', notebookFilename: 'inspire_discover' },
  implement: { runType: 'implement', params: { ...personParams, inspire_implement_spec_version: '3' }, businessName: 'Acme', notebookFilename: 'inspire_generate',
    useCaseIds: ['UC-7'], useCaseName: 'Churn early warning' },
};

function noTestTag(run) {
  const saved = process.env.INSPIRE_TEST_TAG;
  delete process.env.INSPIRE_TEST_TAG;
  try { return run(); } finally { if (saved !== undefined) process.env.INSPIRE_TEST_TAG = saved; }
}

function assertNoPerson(tags, label) {
  for (const [key, value] of Object.entries(tags)) {
    const v = String(value).toLowerCase();
    for (const bit of PII) assert.ok(!v.includes(bit), `${label}: tag ${key}=${value} carries the launching person`);
    assert.notEqual(v, PERSON.email.toLowerCase(), `${label}: tag ${key}`);
  }
}

test('T-NB2-02: Discover, Match and Implement keep the exact existing tag keys', () => noTestTag(() => {
  for (const [op, input] of Object.entries(INPUTS)) {
    assert.deepEqual(Object.keys(inspireJobTags(input)).sort(), SNAPSHOT[op], op);
  }
}));

test('T-NB2-02: no job tag value equals or contains the launching person email or name', () => noTestTag(() => {
  for (const [op, input] of Object.entries(INPUTS)) assertNoPerson(inspireJobTags(input), op);
}));

test('T-NB2-02: a real /api/run launch tags the job without the launching person', async () => {
  let resolved = '';
  const workspace = await fakeWorkspace((call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
    if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: PERSON.email, displayName: PERSON.name }];
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: 'main.s.orders' }];
    if (url.pathname === '/api/2.0/sql/statements') return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] } }, result: { data_array: [] } }];
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path').startsWith('/Shared/inspire/')) { resolved = url.searchParams.get('path'); return [200, { object_type: 'NOTEBOOK', path: resolved }]; }
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
    if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    return null;
  });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', NODE_ENV: 'production',
      DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh', INSPIRE_TEST_TAG: '' });
    const resp = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON.email,
        'x-forwarded-preferred-username': PERSON.name },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders' } }),
    });
    assert.equal(resp.status, 200, await resp.text());
    const [job] = workspace.calls.filter((call) => call.path === '/api/2.1/jobs/create').map((call) => call.body);
    assert.ok(job && job.tags, 'the launch created a tagged job');
    for (const key of BASE_KEYS.filter((k) => !k.startsWith('dbx_inspire_ai_session'))) assert.ok(key in job.tags, `job tag ${key} kept`);
    assertNoPerson(job.tags, 'api/run');
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
});
