const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const served = (spec, options) => I.validateImplementSpec(I.withInspireUrl(spec, 'https://inspire.example.com'), options);
const { makeApp, listen } = require('./support/implementApp');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href;
const load = () => import(libUrl);

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const OUT = 'result_table=main.inspire.churn_out';
const HUB = 'sales-hub';
const BUILDER = 'Inspire use case N01-U02 (session 42): Forecast demand';
const OWN = 'Inspire use case N01-U01 (session 42): Predict churn';
const WH = (id) => ({ name: 'sql-warehouse', sql_warehouse: { id, permission: 'CAN_USE' } });
const SPEC = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp' },
};
const WAREHOUSE_ERROR = (shown) => `outputs.app_warehouse_id ${shown} must be the id of a SQL warehouse: up to 64 letters, digits, dashes `
  + 'and underscores, or empty for the SQL warehouse the build uses';
const CANNOT_USE_WH2 = 'Inspire cannot manage Finance SQL, so the App cannot read and save with it: ask the warehouse owner to grant Inspire '
  + 'CAN MANAGE on it, or pick another SQL warehouse for the App';
const LOCK = 'this use case asks the App to read with SQL warehouse whX, but it is added to the App sales-hub, which reads with SQL warehouse '
  + 'wh9, the one use case N01-U02 Forecast demand chose when it built the App; changing it would change the pages of that use case too. '
  + "Keep the App's SQL warehouse, or create a new App for this use case";
const WH2_NAME = { 'GET /api/2.0/sql/warehouses/wh2': [{ id: 'wh2', name: 'Finance SQL' }] };
const WH2_USE_ONLY = { 'GET /api/2.0/permissions/sql/warehouses/wh2': [{ access_control_list: [{ user_name: 'amr@x', all_permissions: [{ permission_level: 'CAN_USE' }] }] }] };
const WH2_MANAGED = { 'GET /api/2.0/permissions/sql/warehouses/wh2': [{ access_control_list: [{ user_name: 'amr@x', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] }] };

async function call(base, p, opts = {}) {
  const resp = await fetch(base + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, fn) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await fn(srv.url, made);
  } finally {
    await srv.close();
  }
}

const preflight = (url, extra) => call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&${extra}`);

test('the App reads with the build warehouse unless the spec names another, and an id that is not a warehouse id is refused', () => {
  assert.equal(served(SPEC).spec.outputs.app_warehouse_id, '', 'a spec without the field reads with the build warehouse');
  const picked = served({ ...SPEC, outputs: { ...SPEC.outputs, app_warehouse_id: ' wh2 ' } });
  assert.deepEqual(picked.errors, []);
  assert.equal(picked.spec.outputs.app_warehouse_id, 'wh2');
  assert.equal(picked.spec.config.warehouse_id, 'wh1', 'dashboards and alerts keep the build warehouse');
  for (const [given, shown] of [['a/b?c', "'a/b?c'"], ['wh 2', "'wh 2'"], ['x'.repeat(65), `'${'x'.repeat(65)}'`]]) {
    const refused = served({ ...SPEC, outputs: { ...SPEC.outputs, app_warehouse_id: given } });
    assert.ok(refused.errors.includes(WAREHOUSE_ERROR(shown)), `${given}: ${JSON.stringify(refused.errors)}`);
    assert.equal(refused.spec.outputs.app_warehouse_id, '');
  }
  assert.ok(served({ ...SPEC, outputs: { ...SPEC.outputs, app_warehouse_id: true } }).errors
    .includes('outputs.app_warehouse_id must be text, not true'));
  const off = served({ ...SPEC, outputs: { dashboard: true, app: false, app_warehouse_id: 'a/b' } });
  assert.deepEqual([off.errors, off.spec.outputs.app_warehouse_id], [[], ''], 'a use case without an App has no App warehouse to check');
});

test('changing only the App warehouse refreshes the App and no other output', () => {
  const before = served(SPEC).spec;
  const after = served({ ...SPEC, outputs: { ...SPEC.outputs, app_warehouse_id: 'wh2' } }).spec;
  const summary = I.implementChangeSummary(before, after, { dashboard: 'd1', genie_space: 'g1', app: 'churn-desk' });
  assert.deepEqual([summary.classes, summary.refresh, summary.build, summary.refill], [['outputs'], ['app'], [], false]);
  assert.ok(I.IMPLEMENT_OUTPUT_OPTIONS.app.includes('app_warehouse_id'));
  assert.deepEqual(I.classifyImplementChange(before, served(SPEC).spec), []);
});

test('an App Inspire built carries the warehouse it reads with and the use case that built it', () => {
  const entry = { id: HUB, holders: [{ session_id: '42', use_case_id: 'N01-U02', use_case_name: 'Forecast demand', app_access: 'sp' }] };
  const target = I.mergeTarget('app', entry, { ok: true, data: { name: HUB, description: BUILDER, resources: [{ name: 'job-x', job: { id: '7' } }, WH('wh9')] } });
  assert.equal(target.warehouse_id, 'wh9');
  assert.deepEqual(target.built_by, { use_case_id: 'N01-U02', name: 'Forecast demand' });
  assert.equal(I.mergeTarget('app', entry, { ok: true, data: { name: HUB, description: BUILDER } }).warehouse_id, '');
  assert.equal(I.appWarehouseOf([{ name: 'x', job: {} }, WH('wh3'), WH('wh4')]), 'wh3');
  assert.equal(I.appWarehouseOf(null), '');
  assert.equal(I.appWarehouseMoves({ resources: [WH('wh1')] }, 'wh2'), true);
  assert.equal(I.appWarehouseMoves({ resources: [WH('wh1')] }, 'wh1'), false);
  assert.equal(I.appWarehouseMoves({ resources: [] }, 'wh2'), false, 'an App without a warehouse resource Inspire set is left as it is');
  assert.equal(I.appWarehouseMoves(null, 'wh2'), false);
});

test('a joining use case that names another warehouse than the App reads with is refused and the message names the use case that built it', () => {
  const target = { id: HUB, name: HUB, access: 'sp', warehouse_id: 'wh9', built_by: { use_case_id: 'N01-U02', name: 'Forecast demand' } };
  const joiner = (warehouse) => ({ outputs: { app: true, app_access: 'sp', merge: { app: HUB }, app_warehouse_id: warehouse } });
  assert.deepEqual(I.mergeProblems(joiner('whX'), { app: [target] }), [LOCK]);
  assert.deepEqual(I.mergeProblems(joiner('whX'), { app: [target] }, { app: HUB }), [LOCK], 'a use case already in the App is still held to its warehouse');
  assert.deepEqual(I.mergeProblems(joiner('wh9'), { app: [target] }), []);
  assert.deepEqual(I.mergeProblems(joiner(''), { app: [target] }), [], 'no warehouse named means the App keeps its own');
  assert.deepEqual(I.mergeProblems(joiner('whX'), { app: [{ ...target, warehouse_id: '' }] }), []);
});

test('the warehouse permission check names the App warehouse and the permission it lacks', () => {
  const denied = { ok: true, data: { access_control_list: [{ user_name: 'amr@x', all_permissions: [{ permission_level: 'CAN_USE' }] }] } };
  assert.deepEqual(I.warehouseManageCheck(denied, ['amr@x'], [], 'Finance SQL', true), { ok: false, detail: CANNOT_USE_WH2 });
  assert.match(I.warehouseManageCheck(denied, ['amr@x'], [], 'Finance SQL').detail, /cannot give a new App access to it: .* re-run the Inspire installer$/);
  const owner = { ok: true, data: { access_control_list: [{ group_name: 'admins', all_permissions: [{ permission_level: 'IS_OWNER' }] }] } };
  assert.deepEqual(I.warehouseManageCheck(owner, ['amr@x'], ['admins'], 'Finance SQL', true), { ok: true, detail: 'the App can read and save with Finance SQL' });
  assert.equal(I.warehouseManageCheck({ ok: false, status: 403 }, [], [], 'Finance SQL', true).detail, CANNOT_USE_WH2);
});

test('preflight checks a new App can be given the warehouse the person picked, by its name and the permission it needs', async () => {
  await withApp({ responses: { ...WH2_NAME, ...WH2_USE_ONLY } }, async (url, made) => {
    const got = await preflight(url, 'app_name=churn-desk&app_warehouse=wh2');
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.checks.app_warehouse, { ok: false, detail: CANNOT_USE_WH2 });
    assert.equal(got.data.ok, false);
    assert.doesNotMatch(got.data.checks.app_access.detail, /wh1/, 'the App does not read with the build warehouse, so it is not checked for it');
    assert.ok(made.fetches.some((f) => f.path === '/api/2.0/permissions/sql/warehouses/wh2'));
  });
  await withApp({ responses: { ...WH2_NAME, ...WH2_MANAGED } }, async (url) => {
    const got = await preflight(url, 'app_name=churn-desk&app_warehouse=wh2');
    assert.deepEqual(got.data.checks.app_warehouse, { ok: true, detail: 'the App can read and save with Finance SQL' });
    assert.equal(got.data.ok, true, JSON.stringify(got.data));
  });
  await withApp({}, async (url, made) => {
    for (const asked of ['', 'wh1', 'a%2Fb']) {
      const got = await preflight(url, `app_name=churn-desk&app_warehouse=${asked}`);
      assert.equal(got.data.checks.app_warehouse, undefined, `${asked}: the build warehouse is checked inside App access, as before`);
      assert.match(got.data.checks.app_access.detail, /Inspire can give a new App access to /);
    }
    assert.ok(!made.fetches.some((f) => f.path.includes('/sql/warehouses/a')), 'an id that is not a warehouse id is never fetched');
  });
});

test('preflight checks the new warehouse when a rebuild moves the App to it, and never for an App that keeps its warehouse or a joined App', async () => {
  const held = (id) => ({ appsByName: { 'churn-desk': { name: 'churn-desk', description: OWN, resources: [WH(id)] } } });
  await withApp({ ...held('wh1'), responses: { ...WH2_NAME, ...WH2_USE_ONLY } }, async (url) => {
    const moved = await preflight(url, 'app_name=churn-desk&app_warehouse=wh2');
    assert.deepEqual(moved.data.checks.app_warehouse, { ok: false, detail: CANNOT_USE_WH2 });
    assert.equal(moved.data.checks.app_access, undefined, 'an App that exists is updated, not created');
    const kept = await preflight(url, 'app_name=churn-desk&app_warehouse=');
    assert.equal(kept.data.checks.app_warehouse, undefined);
    const joined = await preflight(url, `app_name=&merge_app=${HUB}&app_warehouse=wh2`);
    assert.equal(joined.data.checks.app_warehouse, undefined, 'a joined App keeps the warehouse of the App it joins');
  });
  await withApp(held('wh2'), async (url) => {
    const back = await preflight(url, 'app_name=churn-desk&app_warehouse=');
    assert.deepEqual(back.data.checks.app_warehouse, { ok: true, detail: 'Inspire can give a new App access to wh1' },
      'moving back to the build warehouse checks the build warehouse');
  });
});

test('plan refuses a joining spec that names another warehouse than the App it joins reads with', async () => {
  const registry = [{
    session_id: '42', use_case_id: 'N01-U02', spec_version: 1, status: 'ready', updated_at: '2026-10-26T00:00:00Z', asset_status: null,
    spec_json: JSON.stringify({ use_case_id: 'N01-U02', use_case_name: 'Forecast demand', outputs: { app: true, app_access: 'sp' } }),
    dashboard_id: null, genie_space_id: null, app_name: HUB,
  }];
  const state = { registry, appsByName: { [HUB]: { name: HUB, description: BUILDER, resources: [WH('wh9')] } } };
  const joiner = (warehouse) => ({ ...SPEC, outputs: { ...SPEC.outputs, app_name: HUB, merge: { app: HUB }, app_warehouse_id: warehouse } });
  await withApp(state, async (url) => {
    const body = (warehouse) => ({ body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: joiner(warehouse) }, method: 'POST' });
    const refused = await call(url, '/api/inspire/implement/plan', body('whX'));
    assert.equal(refused.status, 400, JSON.stringify(refused.data));
    assert.equal(refused.data.error, LOCK);
    for (const warehouse of ['wh9', '']) {
      const planned = await call(url, '/api/inspire/implement/plan', body(warehouse));
      assert.equal(planned.status, 200, `${warehouse}: ${JSON.stringify(planned.data)}`);
    }
  });
});

test('the wizard keeps an empty App warehouse for the build one, labels the field by where the App reads, and locks a joined App', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase({ id: 'N01-U01', Name: 'Predict churn' }, { warehouseId: 'wh1' });
  assert.equal(spec.outputs.app_warehouse_id, '');
  assert.equal(w.appWarehouseOf(spec), 'wh1');
  const picked = w.withAppWarehouse(spec, 'wh2');
  assert.deepEqual([picked.outputs.app_warehouse_id, w.appWarehouseOf(picked)], ['wh2', 'wh2']);
  assert.equal(w.withAppWarehouse(picked, 'wh1').outputs.app_warehouse_id, '', 'picking the build warehouse again stores no choice');
  assert.equal(w.appWarehouseLabel('delta'), 'SQL warehouse the App reads and saves with');
  assert.equal(w.appWarehouseLabel('lakebase'), 'SQL warehouse the App saves, keeps history and runs alerts with (pages read from Lakebase)');
  assert.equal(w.appWarehouseLabel(''), w.appWarehouseLabel('delta'));
  assert.equal(w.APP_BACKEND_CHOICES.find((c) => c.id === 'delta').blurb, undefined,
    'a Delta App needs no blurb: the warehouse row under it says the App reads and saves with that SQL warehouse');
  assert.ok(w.APP_BACKEND_CHOICES.find((c) => c.id === 'lakebase').blurb, 'a Lakebase App keeps its blurb about copying into Lakebase');
  const target = { id: HUB, name: HUB, warehouse_id: 'wh9', built_by: { use_case_id: 'N01-U02', name: 'Forecast demand' } };
  const joined = w.withMergeTarget(picked, 'app', target);
  assert.equal(joined.outputs.app_warehouse_id, '', 'a joined App reads with its own warehouse, so the spec names none');
  assert.equal(w.joinedWarehouseText(target), 'Locked: the pages of this use case read with the SQL warehouse of sales-hub, the one use case '
    + 'N01-U02 chose when it built it; changing it would change the pages of the other use cases in it too.');
  const listed = [{ id: 'wh1', name: 'Shared SQL', state: 'RUNNING' }, { id: 'wh2', name: 'Finance SQL', state: 'STOPPED' }];
  assert.equal(w.warehouseText(listed, 'wh2'), 'Finance SQL (STOPPED)');
  assert.equal(w.warehouseText(listed, 'wh7'), 'wh7');
  assert.equal(w.buildWarehouseNote(listed, 'wh1'), "Dashboards and alerts Inspire builds keep using the build's SQL warehouse, Shared SQL (RUNNING).");
  assert.deepEqual(w.appWarehouseProblems(picked, listed), []);
  assert.deepEqual(w.appWarehouseProblems(w.withAppWarehouse(spec, 'wh7'), listed), ['the SQL warehouse wh7 is not one you can use: pick another for the App']);
  assert.deepEqual(w.appWarehouseProblems(w.withAppWarehouse(spec, 'wh7'), null), [], 'no list yet, so nothing to refuse');
  assert.deepEqual(w.sectionErrors('app_access', w.withAppWarehouse(spec, 'wh7'), { warehouses: listed }),
    ['the SQL warehouse wh7 is not one you can use: pick another for the App']);
  assert.equal(w.PREFLIGHT_LABELS.app_warehouse, 'App SQL warehouse');
});

test('the build SQL warehouse is picked by name from the list, keeps a saved id the list lacks, shows each state, and falls back to a typed id only when the list is empty or fails', async () => {
  const w = await load();
  const listed = [{ id: 'wh1', name: 'Shared SQL', state: 'RUNNING' }, { id: 'wh2', name: 'Finance SQL', state: 'STOPPED' },
    { id: 'wh3', name: 'Old SQL', state: 'DELETED' }];
  assert.deepEqual(w.warehouseOptions(listed, ['wh1']).map((o) => o.id), ['wh1', 'wh2', 'wh3'], 'a listed id adds no extra option');
  assert.deepEqual(w.warehouseOptions(listed, ['wh7', ' wh7 ', 'wh1', '']).map((o) => [o.id, Boolean(o.missing)]),
    [['wh7', true], ['wh1', false], ['wh2', false], ['wh3', false]], 'a saved id the list lacks stays first, once');
  assert.deepEqual(w.warehouseOptions(null, ['wh7']), [{ id: 'wh7', missing: true }], 'while the list loads the saved id still shows');
  assert.equal(w.warehouseOptionText(listed, { id: 'wh2' }), 'Finance SQL (STOPPED)', 'the name and its state show, never the bare id');
  assert.equal(w.warehouseOptionText(listed, { id: 'wh7', missing: true }), 'wh7 (not in your list of SQL warehouses)');
  assert.equal(w.warehouseOptionText(null, { id: 'wh7', missing: true }), 'wh7', 'no list yet, so nothing is called missing (must-exclude)');
  assert.equal(w.warehouseStateNote(listed, 'wh1'), '', 'a running warehouse needs no note (must-exclude)');
  assert.equal(w.warehouseStateNote(listed, 'wh2'), 'Finance SQL is stopped; it starts when the run uses it, which can take a few minutes.');
  assert.equal(w.warehouseStateNote(listed, 'wh3'), 'Old SQL is deleted; pick another SQL warehouse.');
  assert.equal(w.warehouseStateNote(listed, 'wh7'), '');
  assert.equal(w.warehouseListNote(listed, ''), '', 'a listed set needs no note and no typed fallback (must-exclude)');
  assert.equal(w.warehouseListNote(null, ''), '', 'still loading is not an empty list (must-exclude)');
  assert.equal(w.warehouseListNote([], ''), 'Inspire found no SQL warehouse you can use. Type the warehouse id, or ask an admin for CAN USE on one.');
  assert.equal(w.warehouseListNote(null, 'HTTP 403'), 'Inspire could not list the SQL warehouses (HTTP 403). Type the warehouse id instead.');
});
