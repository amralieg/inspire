// c33 lane B2 acceptance (REQ-577 5, 7): review follow-ups on the plan routes.
// 1. plan/sort classifies every table: a catalog with more tables than one model call holds is sorted in batches, so no table is
//    silently left out because the model never saw it.
// 2. plan/start stores who started the plan (the signed-in person, x-forwarded-email); plan/advance only advances the caller's plans,
//    so one person's open App never launches another person's waiting run with their own token.
// 3. plan/start stores the launch settings (profile_id, notebook_path, cluster_id) in launch_json; plan/advance reuses them for run 2+,
//    not whatever the advance body carries.
// A custom notebook is honoured only for an App manager (launchChoiceOf), so PERSON is a manager in the launch tests.
// The test answers SQL through state.sqlHook (every statement, all rows; the route filters and dedupes in JS) and the model through
// state.modelReply. Written by the coordinator; the lane B2 builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const PERSON = 'l@example.com';
const OTHER = 'o@example.com';
const T = (schema, name) => `main.${schema}.${name}`;
const statements = () => S.state.calls.filter((c) => c.statement).map((c) => c.statement);
const inserts = () => S.state.calls.filter((c) => /INSERT\s+INTO[\s\S]*__inspire_plan/i.test(c.statement)).map((c) => c.raw);
const jobs = () => Object.values(S.state.runJobs).map((job) => job.tasks.find((t) => t.notebook_task).notebook_task);

// ---- 1. every table is classified ----------------------------------------------------------------------------------------------

const MANY = Array.from({ length: 450 }, (_, i) => T(`s${Math.floor(i / 50)}`, `t${String(i).padStart(3, '0')}`));
function metadataHook(sql) {
  if (!/information_schema/i.test(sql)) return null;
  const split = MANY.map((t) => t.split('.'));
  if (/information_schema\.columns/i.test(sql)) {
    return S.sqlResult(['table_catalog', 'table_schema', 'table_name', 'column_name', 'data_type', 'comment'], split.map(([c, s, n]) => [c, s, n, 'id', 'bigint', null]));
  }
  if (/information_schema\.tables/i.test(sql)) {
    return S.sqlResult(['table_catalog', 'table_schema', 'table_name', 'table_type', 'comment'], split.map(([c, s, n]) => [c, s, n, 'MANAGED', '']));
  }
  return null;
}
const promptText = (body) => (Array.isArray(body && body.messages) ? body.messages.map((m) => String(m.content || '')).join('\n') : '');
const tablesIn = (text) => [...new Set(text.match(/main\.s\d+\.t\d{3}/g) || [])];
// The model places every table it was shown, one run per schema.
const modelSees = [];
function modelReply(body) {
  const shown = tablesIn(promptText(body));
  modelSees.push(shown.length);
  const bySchema = new Map();
  for (const t of shown) {
    const schema = t.split('.')[1];
    if (!bySchema.has(schema)) bySchema.set(schema, []);
    bySchema.get(schema).push({ table: t, why: 'same area' });
  }
  return JSON.stringify({ runs: [...bySchema].map(([schema, tables]) => ({ name: `Area ${schema}`, why: 'same schema', tables })), left_out: [] });
}

test('REQ-577 5: plan/sort shows the model every table, in batches, and none is left out unseen (must-fail on 962f86c8b)', async () => {
  S.reset();
  modelSees.length = 0;
  S.state.sqlHook = metadataHook;
  S.state.modelReply = modelReply;
  const got = await S.request('POST', '/api/inspire/plan/sort', { person: PERSON, body: { warehouse_id: S.APP_WAREHOUSE, catalogs: ['main'], business_name: 'Example Co' } });
  assert.equal(got.status, 200, got.text);
  assert.ok(modelSees.length >= 2, `450 tables need more than one model call (calls: ${modelSees.length})`);
  for (const n of modelSees) assert.ok(n <= 400, `one model call shows at most 400 tables, saw ${n}`);
  assert.equal(modelSees.reduce((a, b) => a + b, 0), MANY.length, 'the model sees each table exactly once');
  const placed = got.data.runs.flatMap((r) => r.tables.map((t) => t.table));
  assert.deepEqual([...placed].sort(), [...MANY].sort(), 'every table is placed in a run');
  const leftOut = (got.data.left_out || []).flatMap((g) => g.tables || []);
  assert.deepEqual(leftOut, [], 'nothing is left out the model never saw');
  for (const run of got.data.runs) assert.ok(run.tables.length <= 25, `run ${run.name} has ${run.tables.length} tables`);
  assert.deepEqual(got.data.runs.map((r) => r.run_no), got.data.runs.map((_r, i) => i + 1));
  assert.equal(got.data.read_tables, MANY.length);
});

// ---- 2 + 3. owner and launch settings ------------------------------------------------------------------------------------------

const PLAN = { runs: [
  { run_no: 1, name: 'Sales', why: 'w', tables: [{ table: T('sales', 'orders') }] },
  { run_no: 2, name: 'Operations', why: 'w', tables: [{ table: T('ops', 'shift') }] },
] };
const PARAMS = { '00_business_name': 'Example Co', '03_discovery_type': 'Standard Discovery', '15_operation': 'Discover Use Cases' };
const NOTEBOOK = '/Shared/inspire-custom/inspire_custom_notebook';
const START_BODY = { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE, business_name: 'Example Co', plan: PLAN, params: PARAMS,
  profile_id: 'prof-17', notebook_path: NOTEBOOK };

test('REQ-577 7: plan/start stores the owner and the launch settings with every plan row (must-fail on 962f86c8b)', async () => {
  S.reset({ managers: [PERSON], notebookPresent: true, notebookObjects: [NOTEBOOK] });
  const got = await S.request('POST', '/api/inspire/plan/start', { person: PERSON, body: START_BODY });
  assert.equal(got.status, 200, got.text);
  assert.equal(jobs()[0].notebook_path, NOTEBOOK, 'run 1 uses the notebook the user picked');
  const sql = statements().find((s) => /CREATE\s+TABLE[\s\S]*__inspire_plan/i.test(s)) || '';
  assert.match(sql, /\bowner\s+STRING\b/i, 'the plan table has an owner column');
  assert.match(sql, /\blaunch_json\s+STRING\b/i, 'the plan table has a launch_json column');
  const rows = inserts();
  assert.ok(rows.length >= 2, 'the plan rows and run 1 running are stored');
  for (const raw of rows) {
    assert.ok(raw.includes(PERSON), 'every plan row carries the owner');
    assert.ok(raw.includes('prof-17') && raw.includes('inspire_custom_notebook'), 'every plan row carries profile_id and notebook_path');
  }
});

const PLAN_COLUMNS = ['plan_id', 'run_no', 'name', 'tables', 'params_json', 'session_id', 'run_id', 'status', 'event_at', 'owner', 'launch_json'];
const LAUNCH = JSON.stringify({ profile_id: 'prof-17', notebook_path: NOTEBOOK, cluster_id: '' });
const planRows = (planId, owner, runId) => [
  [planId, '1', 'Example Co: Sales', T('sales', 'orders'), JSON.stringify(PARAMS), '9101', runId, 'running', '2026-11-28T09:01:00Z', owner, LAUNCH],
  [planId, '2', 'Example Co: Operations', T('ops', 'shift'), JSON.stringify(PARAMS), null, null, 'waiting', '2026-11-28T09:00:00Z', owner, LAUNCH],
];
const planHook = (rows) => (sql) => (/^\s*(SELECT|WITH)\b/i.test(sql) && /__inspire_plan/.test(sql) ? S.sqlResult(PLAN_COLUMNS, rows) : null);
const ADVANCE_BODY = { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE };

test('REQ-577 7: plan/advance never launches another person\'s waiting run (must-fail on 962f86c8b)', async () => {
  S.reset({ managers: [PERSON], notebookPresent: true, notebookObjects: [NOTEBOOK], runStates: { 700: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } } });
  S.state.sqlHook = planHook(planRows('p-other', OTHER, '700'));
  const got = await S.request('POST', '/api/inspire/plan/advance', { person: PERSON, body: ADVANCE_BODY });
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.data.started, []);
  assert.deepEqual(jobs(), [], 'another person\'s plan does not start with my token');
  assert.ok(!inserts().length, 'another person\'s plan rows are not touched');
});

test('REQ-577 7: plan/advance launches the caller\'s run 2 with the stored launch settings, not the advance body (must-fail on 962f86c8b)', async () => {
  S.reset({ managers: [PERSON], notebookPresent: true, notebookObjects: [NOTEBOOK], runStates: { 700: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' }, 701: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } } });
  S.state.sqlHook = planHook([...planRows('p-mine', PERSON, '700'), ...planRows('p-other', OTHER, '701')]);
  const got = await S.request('POST', '/api/inspire/plan/advance', { person: PERSON, body: { ...ADVANCE_BODY, notebook_path: '/Workspace/Shared/some_other_notebook' } });
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.data.started.map((s) => [s.plan_id, s.run_no]), [['p-mine', 2]], 'only my plan advances');
  const sent = jobs();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].notebook_path, NOTEBOOK, 'run 2 uses the notebook stored at plan/start');
  assert.equal(sent[0].base_parameters['00_business_name'], 'Example Co: Operations');
  for (const raw of inserts()) assert.ok(raw.includes(PERSON) && !raw.includes('p-other'), 'only my plan rows are appended, still with owner');
});
