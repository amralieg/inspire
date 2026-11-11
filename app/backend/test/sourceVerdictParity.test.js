const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const SOURCE = 'main.s.orders';
const PERSON = 'person-tok';
const POLICY = /^\/api\/2\.1\/unity-catalog\/policies\/table\//;
const DENIED = [{ error_code: 'PERMISSION_DENIED', message: 'User does not have READ METADATA on Table' }, 403];
const USE_CASE = { id: 'N01-U01', use_case: 'Assess water assets', primary_table: SOURCE, tables_involved: SOURCE };
const BUILD_SPEC = {
  use_case_id: 'N01-U01',
  use_case_name: 'Assess water assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out', widgets: { act_now_share: '0.05' } },
  outputs: { dashboard: true },
};

async function call(base, url, { method = 'GET', body, headers = {} } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, run) {
  const { app } = makeApp({ useCase: USE_CASE, ...overrides });
  const srv = await listen(app);
  try {
    await run(srv.url);
  } finally {
    await srv.close();
  }
}

const appCannotReadPolicies = ({ token, path }) => (token !== PERSON && POLICY.test(path) ? DENIED : undefined);

test('parity guard: a first build refused for the App read gets the same sentence from the plan as from the preflight (passes before and after the fix)', async () => {
  await withApp({ tokenKind: 'app', forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] },
    me: { applicationId: 'app-sp-2', displayName: 'riverside-assets' }, workspace: appCannotReadPolicies }, async (url) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`);
    assert.equal(pre.status, 200, JSON.stringify(pre.data));
    assert.equal(pre.data.checks.sources.ok, false, 'the preflight refuses');
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: BUILD_SPEC } });
    assert.equal(plan.status, 409, `the plan refuses a build that reads the source as the App: ${JSON.stringify(plan.data)}`);
    assert.equal(plan.data.error, pre.data.checks.sources.detail, 'the plan and the preflight give the same sentence');
  });
});

test('a person-identity request with no App token refuses the source read instead of running the App check as the person (must fail before the fix)', async () => {
  await withApp({ tokenKind: 'person', dbToken: PERSON, forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] } }, async (url) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`);
    assert.equal(pre.status, 200, JSON.stringify(pre.data));
    assert.equal(pre.data.checks.sources.ok, false, 'the person can read the policies, but the App check cannot run as the person');
    assert.match(pre.data.checks.sources.detail, /cannot check what the App can read right now/);
    assert.equal(pre.data.ok, false);
  });
});

test('a clean App read (App token present, policies readable) still passes the preflight and the plan (must-exclude control)', async () => {
  await withApp({ tokenKind: 'app', appToken: 'app-tok', forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] } }, async (url) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`);
    assert.equal(pre.data.checks.sources.ok, true, JSON.stringify(pre.data.checks.sources));
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: BUILD_SPEC } });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
  });
});
