const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen, ORG_ID } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const APP_ID = '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d';
const SP = { userName: APP_ID, displayName: 'app-q7k2m9 inspire-ai', applicationId: APP_ID };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1' }, outputs: {} };
const row = (id, extra = {}) => ({
  session_id: '42', use_case_id: id, spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-11-12T04:00:00Z',
  spec_json: JSON.stringify({ ...SPEC, use_case_id: id }), asset_status: JSON.stringify({}), ...extra,
});
// N01-U01 built everything; N01-U02 built only a dashboard; N01-U03 was never built.
const HISTORY = [
  row('N01-U01', { app_name: 'churn-app', app_url: 'https://churn.example.com', dashboard_id: 'd1', genie_space_id: 'g1', lakebase_project_id: 'lb1',
    job_id: '111', warehouse_id: 'wh9', use_case_name_tag: 'predict_customer_churn',
    asset_status: JSON.stringify({ app: { state: 'ready', app_id: 'app-1' } }) }),
  row('N01-U02', { dashboard_id: 'd2', job_id: '222', warehouse_id: 'wh9', use_case_name_tag: 'flag_late_suppliers' }),
  row('N01-U03', { status: 'failed', job_id: '333', use_case_name_tag: 'rank_stores' }),
];
const BILLING = [
  { use_case_name: null, job_id: '111', app_id: null, warehouse_id: null, lakebase_id: null, dbus: '10.5' },
  { use_case_name: null, job_id: null, app_id: 'app-1', warehouse_id: null, lakebase_id: null, dbus: '4' },
  { use_case_name: null, job_id: null, app_id: null, warehouse_id: null, lakebase_id: 'lb1', dbus: '1.5' },
  { use_case_name: 'flag_late_suppliers', job_id: '999', app_id: null, warehouse_id: null, lakebase_id: null, dbus: '2' },
  { use_case_name: null, job_id: null, app_id: null, warehouse_id: 'wh9', dbus: '50' },
];

async function withApp(overrides, run) {
  const made = makeApp({ history: HISTORY, me: SP, appMe: SP, tokenKind: 'app', forwardedEmail: OWNER, ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}
const get = async (base, path) => { const r = await fetch(`${base}${path}?${Q}`); return { status: r.status, data: await r.json() }; };

test('REQ-427: each use case shows App, Dashboard, Lakebase and Genie as built, from the tracking rows, with no billing read', async () => {
  await withApp({}, async (url, made) => {
    const got = await get(url, '/api/inspire/implement/usecase-assets');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.use_cases, {
      'N01-U01': { app: true, dashboard: true, lakebase: true, genie: true },
      'N01-U02': { app: false, dashboard: true, lakebase: false, genie: false },
      'N01-U03': { app: false, dashboard: false, lakebase: false, genie: false },
    });
    assert.equal(made.sqlCalls.filter((c) => /system\.billing/.test(c.sql)).length, 0, 'the flags never wait on billing');
    assert.deepEqual([...new Set(made.sqlCalls.map((c) => c.token))], ['tok'], 'every read uses the App identity');
  });
});

test('REQ-427: a deleted asset is not counted as built', async () => {
  const gone = [row('N01-U01', { dashboard_id: 'd1', asset_status: JSON.stringify({ dashboard: { state: 'deleted' } }) })];
  await withApp({ history: gone }, async (url) => {
    assert.equal((await get(url, '/api/inspire/implement/usecase-assets')).data.use_cases['N01-U01'].dashboard, false);
  });
});

test('REQ-427: total DBUs per use case sum the recorded ids and the name tag, once each, and a shared warehouse is nobody’s', async () => {
  await withApp({ statements: { 'system.billing.usage': (sql, parameters) => {
    assert.match(sql, /usage_unit = 'DBU'/);
    // system.billing.usage is account-wide: a job id or a name tag of another workspace must never count here.
    const ws = parameters.find((p) => p.value === ORG_ID);
    assert.ok(ws, 'the workspace id is a parameter');
    assert.match(sql, new RegExp(`workspace_id = :${ws.name} AND \\(`));
    const values = parameters.map((p) => p.value);
    for (const id of ['111', '222', '333', 'app-1', 'lb1', 'predict_customer_churn', 'flag_late_suppliers']) assert.ok(values.includes(id), id);
    assert.ok(!values.includes('wh9'), 'a warehouse two use cases name is not looked up');
    return { rows: BILLING.filter((r) => r.warehouse_id !== 'wh9') };
  } } }, async (url, made) => {
    const got = await get(url, '/api/inspire/implement/usecase-dbus');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.state, 'ok');
    assert.deepEqual(got.data.use_cases, { 'N01-U01': 16, 'N01-U02': 2, 'N01-U03': null });
    assert.deepEqual([...new Set(made.sqlCalls.map((c) => c.token))], ['tok']);
  });
});

test('REQ-427: when the App cannot read system.billing the DBU read says so, offers the GRANT, and the flags still load', async () => {
  const denied = { 'system.billing.usage': 'PERMISSION_DENIED: User does not have USE SCHEMA on Schema \'system.billing\'.' };
  await withApp({ sqlErrors: denied }, async (url) => {
    const dbus = await get(url, '/api/inspire/implement/usecase-dbus');
    assert.equal(dbus.status, 200, JSON.stringify(dbus.data));
    assert.equal(dbus.data.state, 'denied');
    assert.deepEqual(Object.values(dbus.data.use_cases), [null, null, null], 'never a made-up 0');
    assert.equal(dbus.data.permissions.length, 1);
    assert.equal(dbus.data.permissions[0].principal, APP_ID);
    assert.ok(dbus.data.permissions[0].statements.includes(`GRANT SELECT ON TABLE \`system\`.\`billing\`.\`usage\` TO \`${APP_ID}\``), JSON.stringify(dbus.data.permissions));
    assert.equal((await get(url, '/api/inspire/implement/usecase-assets')).status, 200);
  });
});

test('REQ-427: with no billing id recorded the DBU read says so and makes no billing read', async () => {
  await withApp({ history: [row('N01-U01')] }, async (url, made) => {
    const got = await get(url, '/api/inspire/implement/usecase-dbus');
    assert.deepEqual([got.data.state, got.data.use_cases], ['none', { 'N01-U01': null }]);
    assert.equal(made.sqlCalls.filter((c) => /system\.billing/.test(c.sql)).length, 0);
  });
});

test('REQ-427: when the workspace id is unknown the DBU read shows no total rather than an account-wide one', async () => {
  await withApp({ orgId: null }, async (url, made) => {
    const got = await get(url, '/api/inspire/implement/usecase-dbus');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.state, 'unscoped');
    assert.deepEqual(Object.values(got.data.use_cases), [null, null, null]);
    assert.equal(made.sqlCalls.filter((c) => /system\.billing/.test(c.sql)).length, 0);
  });
});
