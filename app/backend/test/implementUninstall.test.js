const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeApp, listen } = require('./support/implementApp');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const latest = (outputs) => ({ spec_json: { outputs } });
const HUB = { id: 'sales-hub', use_cases: [{ session_id: '42', use_case_id: 'N01-U02', name: 'Forecast demand' }] };
const live = (shared) => ({ shared: { dashboard: null, genie_space: null, app: null, ...shared } });
const APP = { id: 'app', label: 'App' };
const DASH = { id: 'dashboard', label: 'Dashboard' };
const AGENT = { id: 'genie_space', label: 'Genie Agent' };

test('an asset only this use case holds is uninstalled, and one another use case shares is removed from it by name', async () => {
  const C = await lib('implementControl.js');
  const alone = C.assetUninstall('app', latest({ app: true }), live({}), 'churn-desk');
  assert.deepEqual(alone, { label: 'Uninstall', others: [], target: 'churn-desk', blocked: '', unknown: false });
  const hub = C.assetUninstall('app', latest({ app: true, merge: { app: 'sales-hub' } }), live({ app: HUB }), 'sales-hub');
  assert.equal(hub.label, 'Remove from sales-hub');
  assert.deepEqual(hub.others.map((u) => u.use_case_id), ['N01-U02']);
  assert.equal(C.assetUninstall('app', latest({ app: true }), live({ app: HUB })).label, 'Remove from sales-hub', 'the shared id names it when the row has no name');
  assert.equal(C.assetUninstall('dashboard', latest({ dashboard: true }), live({ app: HUB }), 'Churn').label, 'Uninstall',
    'another output being shared changes nothing here');
});

test('the Genie Agent cannot be uninstalled while the App asks it, and can once the App is gone', async () => {
  const C = await lib('implementControl.js');
  const W = await lib('implementWizard.js');
  const blocked = C.assetUninstall('genie_space', latest({ app: true, genie_space: true }), live({}), 'Churn agent');
  assert.equal(blocked.blocked, `${W.GENIE_FOR_APP_NOTE} Uninstall the App first.`);
  assert.equal(C.assetUninstall('genie_space', latest({ app: false, genie_space: true }), live({}), 'Churn agent').blocked, '');
  assert.equal(C.assetUninstall('app', latest({ app: true, genie_space: true }), live({}), 'x').blocked, '', 'only the Genie Agent is held by the App');
});

test('the confirm text says what is deleted, what is taken out of a shared asset, and what Inspire could not check', async () => {
  const C = await lib('implementControl.js');
  const alone = C.assetUninstall('dashboard', latest({ dashboard: true }), live({}), 'Churn board');
  assert.equal(C.uninstallText(DASH, { name: 'Churn board' }, alone),
    'Inspire deletes the Dashboard Churn board in a new version of this MVP and keeps the other outputs. You can add it back with Edit MVP. '
    + "Inspire checks again when the job runs: if another use case shares it by then, Inspire takes out only this use case's pages and keeps it for them.");
  assert.doesNotMatch(C.uninstallText({ id: 'alert', label: 'Alert' }, { name: 'Churn alert' }, alone), /checks again/,
    'an alert is never shared, so there is nothing to check again');
  const hub = C.assetUninstall('app', latest({ app: true }), live({ app: HUB }), 'sales-hub');
  assert.equal(C.uninstallText(APP, { name: 'sales-hub' }, hub),
    "Inspire takes this use case's pages out of sales-hub in a new version of this MVP and keeps the other outputs. sales-hub stays for Forecast demand. "
    + 'If no other use case holds it by the time the job runs, Inspire deletes it instead.');
  const many = { ...hub, others: ['A', 'B', 'C', 'D'].map((name) => ({ name })) };
  assert.match(C.uninstallText(AGENT, { name: 'Agent' }, many), /tables, instructions and sample questions out of Agent .* stays for A, B and 2 more use cases\. If no other/);
  assert.match(C.uninstallText(APP, { name: 'x' }, { ...hub, others: [{ name: 'A' }, { use_case_id: 'N09-U09' }, { name: '  ' }] }), /stays for A and N09-U09\. If no other/,
    'a holder with no name is named by its id, and an empty one is dropped');
  const unknown = C.assetUninstall('app', latest({ app: true }), { shared: null, shared_error: 'no SELECT' }, 'churn-desk');
  assert.deepEqual([unknown.label, unknown.unknown], ['Uninstall', true]);
  assert.match(C.uninstallText(APP, { name: 'churn-desk' }, unknown), /could not check whether other use cases share it, so it checks again first/);
  assert.doesNotMatch(C.uninstallText(APP, { name: 'churn-desk' }, unknown), /checks again when the job runs/, 'the check is said once');
  assert.equal(C.assetUninstall('app', latest({ app: true }), null, 'x').unknown, false, 'no live status yet is not a failed check');
});

test('an output this use case was taken out of says so on its tile, and one it deleted or never had says nothing more', async () => {
  const C = await lib('implementControl.js');
  const taken = { spec_version: 4, spec_json: { outputs: { app: false, dashboard: true } }, asset_status: {
    app: { state: 'released', note: 'x', taken_out_of: 'sales-hub', stays_for: ['N02-U01', 'N02-U02'] },
    alert: { state: 'deleted', note: 'deleted' } } };
  const tiles = C.controlTiles({ targets: {}, assets: {}, shared: {} }, taken).tiles;
  const off = (id) => tiles.find((t) => t.output.id === id);
  assert.equal(off('app').kind, 'off');
  assert.equal(off('app').note, "This use case's pages were taken out of sales-hub, which stays for N02-U01 and N02-U02.");
  assert.equal(off('alert').note, undefined, 'a deleted output has no note');
  assert.equal(C.takenOutText({ state: 'released', note: 'refused' }, 'app'), '', 'an output Inspire only let go of was not taken out of anything');
  assert.equal(C.takenOutText({ state: 'released', taken_out_of: 'gA', stays_for: [] }, 'genie_space'),
    "This use case's tables, instructions and sample questions were taken out of gA.");
});

const REGISTRY_ROW = (uc, extra) => ({ session_id: '42', use_case_id: uc, spec_version: 1, status: 'ready', updated_at: '2026-10-21T00:00:00Z',
  spec_json: JSON.stringify({ use_case_name: uc === 'N01-U02' ? 'Forecast demand' : 'Predict churn', outputs: { app: true } }), asset_status: null,
  dashboard_id: null, genie_space_id: null, app_name: null, ...extra });
const BUILT_ROW = { spec_version: 2, status: 'ready', use_case_id: 'N01-U01', job_id: '77', dashboard_id: 'd1', genie_space_id: 'g1', app_name: 'churn-desk',
  spec_json: { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
    outputs: { dashboard: true, app: true, app_name: 'churn-desk', genie_space: true } } };
const PLAN_SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', based_on_version: 2,
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true, genie_space: true, app: false },
  removed_outputs: { app: 'delete' } };

async function plan(overrides, spec = PLAN_SPEC) {
  const made = makeApp({ history: [BUILT_ROW], ...overrides });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec }) });
    return { status: resp.status, data: await resp.json(), made };
  } finally {
    await srv.close();
  }
}

test('the plan of a removal says which removed output other use cases share, so the page can say it takes this use case out instead', async () => {
  const registry = [REGISTRY_ROW('N01-U01', { spec_version: 2, app_name: 'churn-desk', dashboard_id: 'd1', genie_space_id: 'g1' }),
    REGISTRY_ROW('N01-U02', { app_name: 'churn-desk' })];
  const got = await plan({ registry });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.summary.delete, ['app']);
  assert.deepEqual(got.data.shared.app, { id: 'churn-desk', use_cases: [{ session_id: '42', use_case_id: 'N01-U02', name: 'Forecast demand' }] });
  assert.equal(got.data.shared_error, '');
  const blind = await plan({ registryError: 'PERMISSION_DENIED: no SELECT on __inspire_implement' });
  assert.equal(blind.status, 200, 'a registry Inspire cannot read never stops the plan');
  assert.deepEqual([blind.data.shared, blind.data.shared_error], [null, 'PERMISSION_DENIED: no SELECT on __inspire_implement']);
  const kept = await plan({ registry }, { ...PLAN_SPEC, removed_outputs: { app: 'keep' } });
  assert.equal(kept.status, 200, JSON.stringify(kept.data));
  assert.equal('shared' in kept.data, false, 'a plan that deletes no shareable output reads no registry');
  assert.equal(kept.made.sqlCalls.some((c) => String(c.sql).includes('`app_name` IS NOT NULL')), false);
});
