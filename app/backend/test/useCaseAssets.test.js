const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

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

// REQ-459 (Amr: "Drop DBUs per use case"): the DBU read and everything that only served it are gone.
test('REQ-459: the usecase-dbus route is gone (404) and the App makes no system.billing read, while the flags still load', async () => {
  await withApp({}, async (url, made) => {
    const dbus = await get(url, '/api/inspire/implement/usecase-dbus');
    assert.equal(dbus.status, 404, JSON.stringify(dbus.data));
    assert.equal((await get(url, '/api/inspire/implement/usecase-assets')).status, 200);
    assert.equal(made.sqlCalls.filter((c) => /system\.billing/.test(c.sql)).length, 0);
  });
});

test('REQ-459: no source file of the App names system.billing or the DBU read', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'dist'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|jsx|json)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(__dirname, '..'));
  walk(path.join(__dirname, '..', '..', 'frontend', 'src'));
  const hits = files.filter((f) => /system\.billing|usecase-dbus|\bBILLING_TABLE\b/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(path.join(__dirname, '..', '..'), f)), []);
});
