const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const SOURCE = 'main.s.orders';
const PERSON = 'person-tok';
const POLICY = /^\/api\/2\.1\/unity-catalog\/policies\/table\//;
const TABLE = /^\/api\/2\.1\/unity-catalog\/tables\//;
const DENIED = [{ error_code: 'PERMISSION_DENIED', message: 'User does not have READ METADATA on Table' }, 403];
const USE_CASE = { id: 'N01-U01', use_case: 'Assess water assets', primary_table: SOURCE, tables_involved: SOURCE };
const BUILD_SPEC = {
  use_case_id: 'N01-U01',
  use_case_name: 'Assess water assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out', widgets: { act_now_share: '0.05' } },
  outputs: { dashboard: true },
};
const APP_SP = { applicationId: 'app-sp-2', displayName: 'riverside-assets' };
const DENIED_SOURCE = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'.";

async function call(base, url, { method = 'GET', body } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
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
const personCannotReadTable = ({ token, path }) => (token === PERSON && TABLE.test(path) ? DENIED : undefined);

const CASES = [
  { name: 'a first build whose App cannot read the source policies',
    overrides: { tokenKind: 'app', forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] }, me: APP_SP, workspace: appCannotReadPolicies } },
  { name: 'a first build whose source the App cannot read',
    overrides: { tokenKind: 'app', forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] }, probeErrors: { '`main`.`s`.`orders`': DENIED_SOURCE } } },
  { name: 'a first build whose source the person cannot read',
    overrides: { tokenKind: 'app', forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] }, workspace: personCannotReadTable } },
];

for (const c of CASES) {
  test(`parity: ${c.name} gets one verdict from the preflight and the plan for the same spec (fails before the fix)`, async () => {
    await withApp(c.overrides, async (url) => {
      const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`, { method: 'POST', body: { spec: BUILD_SPEC } });
      assert.equal(pre.status, 200, JSON.stringify(pre.data));
      const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: BUILD_SPEC } });
      assert.ok(plan.status >= 400 && plan.status < 500, `the plan refuses: ${JSON.stringify(plan.data)}`);
      assert.equal(pre.data.checks.sources.ok, false, `the preflight refuses the same build: ${JSON.stringify(pre.data.checks.sources)}`);
      assert.equal(pre.data.checks.sources.detail, plan.data.error, 'the preflight and the plan give the same sentence');
    });
  });
}

test('person identity with no App token refuses the source read instead of running the App check as the person (fails before the fix)', async () => {
  await withApp({ tokenKind: 'person', dbToken: PERSON, forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] } }, async (url) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`, { method: 'POST', body: { spec: BUILD_SPEC } });
    assert.equal(pre.status, 200, JSON.stringify(pre.data));
    assert.equal(pre.data.checks.sources.ok, false, 'the person can read the policies, but the App check cannot run as the person');
    assert.match(pre.data.checks.sources.detail, /cannot check what the App can read right now/);
    assert.equal(pre.data.ok, false);
  });
});

test('a clean build (App token present, App and person can read the source) passes the preflight and the plan (must-exclude control)', async () => {
  await withApp({ tokenKind: 'app', appToken: 'app-tok', forwardedToken: PERSON, readableTables: { [PERSON]: [SOURCE] } }, async (url) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`, { method: 'POST', body: { spec: BUILD_SPEC } });
    assert.equal(pre.data.checks.sources.ok, true, JSON.stringify(pre.data.checks.sources));
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: BUILD_SPEC } });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
  });
});
