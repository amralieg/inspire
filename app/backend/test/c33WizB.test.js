// c33 lane B acceptance (REQ-577 5): the plan routes. plan/sort reads information_schema only and asks the model for ordered runs of at most
// 25 tables; plan/start stores the plan and launches run 1 only; plan/advance launches the next run once the one before it ended.
// The test answers SQL through state.sqlHook (every statement, all rows; the route dedupes in JS) and the model through state.modelReply.
// Written by the c33 planner; the lane B builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const PERSON = 'l@example.com';
const T = (schema, name) => `main.${schema}.${name}`;
const SALES = Array.from({ length: 30 }, (_, i) => T('sales', `t${String(i + 1).padStart(2, '0')}`));
const ALL = [...SALES, T('ops', 'shift')];
const statements = () => S.state.calls.filter((c) => c.statement).map((c) => c.statement);
const launches = () => Object.values(S.state.runJobs).map((job) => job.tasks.find((t) => t.notebook_task).notebook_task.base_parameters);

function metadataHook(sql) {
  if (!/information_schema/i.test(sql)) return null;
  const split = ALL.map((t) => t.split('.'));
  if (/information_schema\.columns/i.test(sql)) {
    return S.sqlResult(['table_catalog', 'table_schema', 'table_name', 'column_name', 'data_type', 'comment'],
      split.flatMap(([c, s, n]) => [[c, s, n, 'id', 'bigint', 'Row id'], [c, s, n, 'amount', 'double', null]]));
  }
  if (/information_schema\.tables/i.test(sql)) {
    return S.sqlResult(['table_catalog', 'table_schema', 'table_name', 'table_type', 'comment'], split.map(([c, s, n]) => [c, s, n, 'MANAGED', `Table ${n}`]));
  }
  return null;
}
const SORT_BODY = { warehouse_id: S.APP_WAREHOUSE, catalogs: ['main'], business_name: 'Example Co' };
const MODEL_PLAN = JSON.stringify({
  runs: [
    { name: 'Sales', why: 'Sales tables join on order id', tables: [...SALES, T('ghost', 'nowhere')].map((table) => ({ table, why: 'sales' })) },
    { name: 'Operations', why: 'Shifts', tables: [{ table: T('ops', 'shift'), why: 'shifts' }] },
  ],
  left_out: [],
});

test('REQ-577 5: plan/sort reads metadata only, drops tables the model invented and splits runs over 25 tables (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = metadataHook;
  S.state.modelReply = () => MODEL_PLAN;
  const got = await S.request('POST', '/api/inspire/plan/sort', { person: PERSON, body: SORT_BODY });
  assert.equal(got.status, 200, got.text);
  const plan = got.data;
  const sql = statements();
  assert.ok(sql.length > 0, 'the sort read the catalog');
  for (const s of sql) assert.match(s, /information_schema/i, `only information_schema is read, never a data row: ${s.slice(0, 120)}`);
  assert.ok(plan.runs.length >= 3, 'the 31-table Sales run is split');
  for (const run of plan.runs) assert.ok(run.tables.length <= 25, `run ${run.name} has ${run.tables.length} tables`);
  assert.deepEqual(plan.runs.map((r) => r.run_no), plan.runs.map((_r, i) => i + 1), 'run_no follows run order');
  const placed = plan.runs.flatMap((r) => r.tables.map((t) => t.table));
  assert.ok(!placed.includes(T('ghost', 'nowhere')), 'a table the model invented is dropped');
  assert.deepEqual([...placed].sort(), [...ALL].sort(), 'every real table is placed once');
  assert.match(plan.runs[0].name, /Sales/);
  assert.deepEqual(plan.catalogs, ['main']);
  assert.equal(plan.read_tables, ALL.length);
  assert.ok(Array.isArray(plan.left_out));
});

test('REQ-577 5: plan/sort answers a plain error when the model answer is not a plan (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = metadataHook;
  S.state.modelReply = () => 'Sorry, I cannot help with that.';
  const got = await S.request('POST', '/api/inspire/plan/sort', { person: PERSON, body: SORT_BODY });
  assert.ok(got.status >= 400 && got.status < 600 && got.status !== 501, `status ${got.status}`);
  assert.equal(typeof got.data.error, 'string');
  assert.doesNotMatch(got.data.error, /SyntaxError|JSON\.parse|at \S+:\d+/, 'no stack or parser text reaches the user');
  assert.deepEqual(launches(), []);
});

test('REQ-577 5: plan/sort refuses a request with no catalog (must-fail on the base)', async () => {
  S.reset();
  const got = await S.request('POST', '/api/inspire/plan/sort', { person: PERSON, body: { ...SORT_BODY, catalogs: [] } });
  assert.equal(got.status, 400, got.text);
});

const PLAN = { runs: [
  { run_no: 1, name: 'Sales', why: 'w', tables: [{ table: T('sales', 'orders') }, { table: T('sales', 'items') }] },
  { run_no: 2, name: 'Operations', why: 'w', tables: [{ table: T('ops', 'shift') }] },
] };
const PARAMS = { '00_business_name': 'Example Co', '01_uc_metadata': 'main', '04_table_election': 'Let Inspire AI decide', '03_discovery_type': 'Standard', '15_operation': 'Discover Use Cases' };
const START_BODY = { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE, business_name: 'Example Co', plan: PLAN, params: PARAMS, profile_id: '' };

test('REQ-577 7: plan/start stores every run and launches run 1 only, with the plan tables (must-fail on the base)', async () => {
  S.reset({ notebookPresent: true });
  const got = await S.request('POST', '/api/inspire/plan/start', { person: PERSON, body: START_BODY });
  assert.equal(got.status, 200, got.text);
  const sent = launches();
  assert.equal(sent.length, 1, 'only run 1 starts');
  const p = sent[0];
  assert.equal(p['00_business_name'], 'Example Co: Sales');
  assert.deepEqual(String(p['01_uc_metadata']).split(',').map((s) => s.trim()).sort(), [T('sales', 'items'), T('sales', 'orders')], 'run 1 tables, not the picker value');
  assert.equal(p['04_table_election'], 'All Tables', 'the plan already chose the tables');
  assert.equal(p['15_operation'], 'Discover Use Cases');
  assert.ok(p['14_session_id'], 'the run has a session id');
  assert.equal(p['03_discovery_type'], 'Standard', 'the Settings step params pass through');
  assert.ok(statements().some((s) => /INSERT\s+INTO[\s\S]*__inspire_plan/i.test(s)), 'the plan is stored in __inspire_plan');
  assert.ok(got.data.plan_id);
  assert.deepEqual(got.data.runs.map((r) => [r.run_no, r.status]), [[1, 'running'], [2, 'waiting']]);
  assert.equal(String(got.data.runs[0].session_id), String(p['14_session_id']));
  assert.ok(got.data.runs[0].run_id);
});

test('REQ-577 7: plan/start refuses a run over 25 tables and launches nothing (must-fail on the base)', async () => {
  S.reset({ notebookPresent: true });
  const big = { runs: [{ run_no: 1, name: 'Big', why: 'w', tables: Array.from({ length: 26 }, (_, i) => ({ table: T('sales', `t${i}`) })) }] };
  const got = await S.request('POST', '/api/inspire/plan/start', { person: PERSON, body: { ...START_BODY, plan: big } });
  assert.equal(got.status, 400, got.text);
  assert.deepEqual(launches(), []);
});

const PLAN_COLUMNS = ['plan_id', 'run_no', 'name', 'tables', 'params_json', 'session_id', 'run_id', 'status', 'event_at'];
const planRows = (run1Status) => [
  ['p1', '1', 'Example Co: Sales', `${T('sales', 'orders')},${T('sales', 'items')}`, JSON.stringify(PARAMS), '9101', '700', 'waiting', '2026-11-28T09:00:00Z'],
  ['p1', '1', 'Example Co: Sales', `${T('sales', 'orders')},${T('sales', 'items')}`, JSON.stringify(PARAMS), '9101', '700', run1Status, '2026-11-28T09:01:00Z'],
  ['p1', '2', 'Example Co: Operations', T('ops', 'shift'), JSON.stringify(PARAMS), null, null, 'waiting', '2026-11-28T09:00:00Z'],
];
const planHook = (rows) => (sql) => (/^\s*(SELECT|WITH)\b/i.test(sql) && /__inspire_plan/.test(sql) ? S.sqlResult(PLAN_COLUMNS, rows) : null);

test('REQ-577 7: plan/advance launches run 2 once run 1 ended, and nothing while it runs (must-fail on the base)', async () => {
  S.reset({ notebookPresent: true, runStates: { 700: { life_cycle_state: 'RUNNING' } } });
  S.state.sqlHook = planHook(planRows('running'));
  const body = { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE };
  const idle = await S.request('POST', '/api/inspire/plan/advance', { person: PERSON, body });
  assert.equal(idle.status, 200, idle.text);
  assert.deepEqual(idle.data.started, []);
  assert.deepEqual(launches(), [], 'nothing starts while run 1 runs');

  S.reset({ notebookPresent: true, runStates: { 700: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } } });
  S.state.sqlHook = planHook(planRows('running'));
  const moved = await S.request('POST', '/api/inspire/plan/advance', { person: PERSON, body });
  assert.equal(moved.status, 200, moved.text);
  const sent = launches();
  assert.equal(sent.length, 1, 'run 2 starts, once');
  assert.equal(sent[0]['00_business_name'], 'Example Co: Operations');
  assert.equal(sent[0]['01_uc_metadata'], T('ops', 'shift'));
  assert.equal(sent[0]['15_operation'], 'Discover Use Cases');
  assert.equal(moved.data.started.length, 1);
  assert.ok(statements().some((s) => /INSERT\s+INTO[\s\S]*__inspire_plan/i.test(s)), 'run 1 done and run 2 running are recorded');
});

test('REQ-577 7: plan/advance with no plan table answers started [] (a workspace with no plan yet) (must-fail on the base)', async () => {
  S.reset({ notebookPresent: true });
  S.state.sqlHook = (sql) => (/__inspire_plan/.test(sql) ? { statement_id: 's1', status: { state: 'FAILED', error: { message: '[TABLE_OR_VIEW_NOT_FOUND] __inspire_plan' } } } : null);
  const got = await S.request('POST', '/api/inspire/plan/advance', { person: PERSON, body: { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE } });
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.data.started, []);
});
