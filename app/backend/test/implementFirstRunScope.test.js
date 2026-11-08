const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const GROUP = '[[{"column":"plan","value":"basic"}]]';
const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out', widgets: { act_now_share: '0.05' } },
  outputs: { dashboard: true, inspire_url: 'https://inspire.example.com' },
};
const specOf = (widgets, extra = {}) => ({ ...JSON.parse(JSON.stringify(BASE)), config: { ...BASE.config, widgets }, ...extra });
const builtRow = (widgets) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(specOf(widgets)).spec), notebook_path: '/W/impl/N01-U01', job_id: '77',
  asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 }, notebook: { state: 'ready', spec_version: 1 } }),
});

async function withApp(history, run) {
  const made = makeApp({ history });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, url, body) {
  const resp = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER }, body: JSON.stringify(body) });
  return { status: resp.status, data: await resp.json() };
}

const CONTRADICTION = "MVP Test Run is recent, but Groups to run on holds plan = basic; a run covers only its MVP Test Run choice, so it would not use plan = basic. "
  + 'Choose One group or Several groups as the MVP Test Run to run on it, or clear Groups to run on';

test('a spec whose MVP Test Run choice contradicts its own scope settings is refused with a plain message before any work', async () => {
  for (const route of ['/api/inspire/implement/plan', '/api/inspire/implement/submit']) {
    await withApp([], async (url, made) => {
      const asked = await call(url, route, { ...DB, spec: specOf({ run_scope: 'recent', scope_days: '30', scope_groups: GROUP }) });
      assert.deepEqual([asked.status, asked.data.error], [400, CONTRADICTION], route);
      assert.equal(made.jobs.length, 0, `${route} starts nothing`);
    });
  }
  await withApp([builtRow({ run_scope: 'groups', scope_groups: GROUP })], async (url) => {
    const asked = await call(url, '/api/inspire/implement/plan', { ...DB, spec: specOf({ run_scope: 'recent', scope_days: '30', scope_groups: GROUP }, { based_on_version: 1 }) });
    assert.deepEqual([asked.status, asked.data.error], [400, CONTRADICTION], 'an edit that keeps the earlier group but changes the choice is refused');
  });
});

test('consistent MVP Test Run settings pass, and a contradiction the earlier version already saved is flagged, not refused', async () => {
  for (const widgets of [{ run_scope: 'groups', scope_groups: GROUP }, { run_scope: 'recent', scope_days: '30' }, { run_scope: 'records', scope_records: '1000' },
    { run_scope: 'all' }, { act_now_share: '0.05' }]) {
    await withApp([], async (url) => {
      const asked = await call(url, '/api/inspire/implement/plan', { ...DB, spec: specOf(widgets) });
      assert.equal(asked.status, 200, `${JSON.stringify(widgets)} passes (must-exclude): ${JSON.stringify(asked.data)}`);
      assert.equal((asked.data.warnings || []).some((w) => w.includes('MVP Test Run is')), false, `${JSON.stringify(widgets)} is not flagged`);
    });
  }
  const carried = { run_scope: 'recent', scope_days: '30', scope_groups: GROUP };
  await withApp([builtRow(carried)], async (url) => {
    const asked = await call(url, '/api/inspire/implement/plan', { ...DB, spec: specOf(carried, { based_on_version: 1 }) });
    assert.equal(asked.status, 200, JSON.stringify(asked.data));
    assert.ok(asked.data.warnings.includes(`${I.FIRST_RUN_CARRIED}${CONTRADICTION}.`), JSON.stringify(asked.data.warnings));
  });
});

test('dropping the setting of another MVP Test Run choice is a settings change, and dropping any other setting still rebuilds', () => {
  const built = ['run_scope', 'scope_groups', 'scope_days', 'scope_records', 'act_now_share'];
  const spec = (widgets) => I.validateImplementSpec(specOf(widgets)).spec;
  assert.equal(I.implementWidgetChangeClass(spec({ run_scope: 'groups', scope_groups: GROUP }), spec({ run_scope: 'recent', scope_days: '30' }), built), 'settings');
  assert.equal(I.implementWidgetChangeClass(spec({ run_scope: 'recent', scope_days: '30', act_now_share: '0.1' }), spec({ run_scope: 'recent', scope_days: '30' }), built), 'config');
});
