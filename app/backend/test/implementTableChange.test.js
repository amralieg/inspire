const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');
const FIXTURE = require('../../agent/tests/fixtures/implement_table_change_cases.json');

const OWNER = ['owner', 'example.com'].join('@');
const OTHER = ['someone.else', 'example.com'].join('@');
const PERSON_TOKEN = 'person-token';
const SP = { userName: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d', displayName: 'app-q7k2m9 inspire-ai', applicationId: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d' };
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const OWNERS_ONLY = 'Only the owners of this use case can change its settings: the person who asked for v1 and the App owners it names';
const NOT_KNOWN = 'Inspire could not tell who you are, so it cannot check that you own this MVP';

const ORDERS = [['order_id', 'STRING'], ['customer_id', 'STRING'], ['order_date', 'DATE'], ['amount', 'DECIMAL(10,2)']];
const rows = (pairs) => pairs.map(([column_name, data_type], i) => ({ column_name, data_type, ordinal_position: i + 1 }));
const COLUMNS = {
  'main.s.orders': rows(ORDERS),
  'main.s.orders_v2': rows([...ORDERS, ['channel', 'STRING']]),
  'main.s.orders_lite': rows(ORDERS.slice(0, 3)),
  'main.s.returns': rows([['return_id', 'STRING'], ['order_id', 'STRING']]),
};
const USE_CASE = {
  id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders,main.s.returns',
  data_evidence: JSON.stringify({ tables: { 'main.s.orders': { rows: 1200, date_ranges: { order_date: { min: '2024-01-01', max: '2026-10-01' } } } },
    joins: [{ child_table: 'main.s.returns', child_column: 'order_id', parent_table: 'main.s.orders', parent_column: 'order_id', rate: 0.9 }] }),
  genie_instruction: '',
};
const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_owners: [] },
};
const builtRow = (extra = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(BASE, 'https://inspire.example.com')).spec), notebook_path: '/W/impl/N01-U01', job_id: '77', dashboard_id: 'd1', app_name: 'churn-desk',
  asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 }, app: { state: 'ready', spec_version: 1 }, notebook: { state: 'ready', spec_version: 1, result_history: 1 } }),
  ...extra,
});
const swapped = (tables) => ({ ...BASE, based_on_version: 1, data: { tables } });

async function withApp(overrides, run) {
  const made = makeApp({ useCase: USE_CASE, history: [builtRow()], columnsByTable: COLUMNS, forwardedToken: PERSON_TOKEN, ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, url, { method = 'GET', body, who = OWNER } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(who ? { 'x-forwarded-email': who } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

const columnReads = (made) => made.sqlCalls.filter((c) => /^SELECT column_name, data_type, ordinal_position FROM/.test(String(c.sql)));

test('every shared table change case is classified exactly as the fixture says', () => {
  assert.ok(FIXTURE.cases.length >= 19);
  for (const c of FIXTURE.cases) {
    assert.deepEqual(I.implementTableChange(c.previous, c.next, c.used, c.columns), c.expected, c.name);
  }
  const classes = new Set(FIXTURE.cases.map((c) => c.expected.class));
  assert.deepEqual([...classes].sort(), [null, 'data', 'settings'].sort(), 'the fixture covers both classes and no change');
  assert.ok(FIXTURE.cases.every((c) => Object.keys(c).sort().join() === 'columns,expected,name,next,previous,used'), 'only plain classifier inputs and outputs');
});

test('the panel text and the Save button say which change it is, before Save', () => {
  const previous = I.validateImplementSpec(BASE).spec.data;
  const next = I.validateImplementSpec(swapped({ 'main.s.orders': 'main.s.orders_v2', 'main.s.returns': 'main.s.returns_v2' })).spec.data;
  assert.deepEqual(I.implementTableChangeText(previous, next, { class: 'settings', missing: [] }, 4),
    { text: 'The next run reads main.s.orders_v2 and main.s.returns_v2. Nothing is rebuilt.', save: 'Save as a settings change' });
  assert.deepEqual(I.implementTableChangeText(previous, next, { class: 'data', missing: [{ table: 'main.s.orders_lite', columns: ['amount', 'status'] },
    { table: 'main.s.returns_v2', columns: ['order_id'] }] }, 4), {
    text: 'Inspire rebuilds this use case with Genie as version 4 and shows the checklist. Missing on main.s.orders_lite: amount, status. '
      + 'Missing on main.s.returns_v2: order_id.',
    save: 'Save and rebuild as version 4',
  });
  assert.deepEqual(I.implementTableChangeText(previous, previous, { class: 'data', missing: [] }, 2),
    { text: 'Inspire rebuilds this use case with Genie as version 2 and shows the checklist.', save: 'Save and rebuild as version 2' });
  assert.deepEqual(I.implementTableChangeText(previous, previous, { class: null, missing: [] }, 2), { text: '', save: '' });
});

test('the columns a use case uses on a table are its Data Evidence columns and, while the agent records no read columns, every column of the table it replaces', () => {
  assert.deepEqual(I.implementEvidenceColumns(USE_CASE.data_evidence, 'MAIN.S.ORDERS'), ['order_date', 'order_id']);
  assert.deepEqual(I.implementEvidenceColumns(USE_CASE.data_evidence, 'main.s.returns'), ['order_id']);
  assert.deepEqual(I.implementEvidenceColumns(JSON.stringify({ signal: { status: 'passed', table: 'main.s.orders', columns: { basket_size: 0.2 } } }), 'main.s.orders'),
    ['basket_size']);
  assert.deepEqual(I.implementEvidenceColumns('not json', 'main.s.orders'), []);
  assert.deepEqual(I.implementEvidenceColumns(null, 'main.s.orders'), []);
  assert.deepEqual(I.implementUsedColumns(USE_CASE.data_evidence, 'main.s.orders', COLUMNS['main.s.orders']),
    ['order_date', 'order_id', 'customer_id', 'amount']);
  assert.deepEqual(I.implementUsedColumns(USE_CASE.data_evidence, 'main.s.orders', []), ['order_date', 'order_id']);
});

test('the wizard and the Settings panel pick a table through one helper: a swap changes only the table, a removal clears what read it and says so', async () => {
  const W = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href);
  const spec = { data: { tables: {}, removed_tables: [], column_roles: { entity_id: 'main.s.returns.order_id', event_date: 'main.s.orders.order_date' },
    filters: [{ table: 'main.s.returns', column: 'reason', op: 'in', values: ['late'] }] } };
  const swap = W.pickedTable(spec, 'main.s.orders', 'main.s.orders_v2');
  assert.deepEqual([swap.spec.data.tables, swap.spec.data.column_roles, swap.notice], [{ 'main.s.orders': 'main.s.orders_v2' }, spec.data.column_roles, null]);
  assert.deepEqual(spec.data.tables, {}, 'the spec it was given is not changed');
  const dropped = W.pickedTable(spec, 'main.s.returns', W.REMOVE_TABLE);
  assert.deepEqual([dropped.spec.data.removed_tables, dropped.spec.data.column_roles, dropped.spec.data.filters],
    [['main.s.returns'], { event_date: 'main.s.orders.order_date' }, []]);
  assert.equal(dropped.notice, 'Removed main.s.returns and cleared its column roles (entity id) and 1 filter on it.');
  assert.equal(W.pickedTable({ data: { tables: {} } }, 'main.s.returns', W.REMOVE_TABLE).notice, 'Removed main.s.returns.');
});

test('the tables panel is for owners only: anyone else sees them read only with the owners text, and so does a request that names no person', async () => {
  await withApp({}, async (url) => {
    assert.deepEqual((await call(url, `/api/inspire/implement/tables?${Q}`)).data, { editable: true, why: '', built_version: 1, next_version: 2 });
    assert.deepEqual((await call(url, `/api/inspire/implement/tables?${Q}`, { who: OTHER })).data,
      { editable: false, why: OWNERS_ONLY, built_version: 1, next_version: 2 });
  });
  await withApp({ me: SP, tokenKind: 'app', forwardedToken: '' }, async (url) => {
    assert.deepEqual((await call(url, `/api/inspire/implement/tables?${Q}`, { who: '' })).data,
      { editable: false, why: NOT_KNOWN, built_version: 1, next_version: 2 });
  });
  await withApp({ history: [] }, async (url) => {
    assert.deepEqual((await call(url, `/api/inspire/implement/tables?${Q}`)).data,
      { editable: false, why: I.IMPLEMENT_SETTINGS_NOT_BUILT, built_version: null, next_version: 1 });
  });
});

test('a table change is classified with the person\u2019s own sign-in: a new table with every used column is a settings change, one without is a rebuild', async () => {
  await withApp({}, async (url, made) => {
    const ok = await call(url, `/api/inspire/implement/table-change?${Q}`, { method: 'POST', body: { ...DB, spec: swapped({ 'main.s.orders': 'main.s.orders_v2' }) } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data, { class: 'settings', missing: [], text: 'The next run reads main.s.orders_v2. Nothing is rebuilt.', save: 'Save as a settings change',
      next_version: 2 });
    assert.deepEqual(columnReads(made).map((c) => [c.parameters.map((p) => p.value).join('.'), c.token]),
      [['s.orders', PERSON_TOKEN], ['s.orders_v2', PERSON_TOKEN]], 'both tables are read with the person\u2019s token, never the App\u2019s');
    const lost = await call(url, `/api/inspire/implement/table-change?${Q}`, { method: 'POST', body: { ...DB, spec: swapped({ 'main.s.orders': 'main.s.orders_lite' }) } });
    assert.deepEqual(lost.data, { class: 'data', missing: [{ table: 'main.s.orders_lite', columns: ['amount'] }],
      text: 'Inspire rebuilds this use case with Genie as version 2 and shows the checklist. Missing on main.s.orders_lite: amount.',
      save: 'Save and rebuild as version 2', next_version: 2 });
  });
});

test('a table change is refused to anyone but an owner, without a sign-in, and for a table the person cannot see', async () => {
  const body = { ...DB, spec: swapped({ 'main.s.orders': 'main.s.orders_v2' }) };
  await withApp({}, async (url, made) => {
    const other = await call(url, `/api/inspire/implement/table-change?${Q}`, { method: 'POST', body, who: OTHER });
    assert.deepEqual([other.status, other.data.error], [403, OWNERS_ONLY]);
    assert.equal(columnReads(made).length, 0, 'nothing is read for a person who may not change it');
    const hidden = await call(url, `/api/inspire/implement/table-change?${Q}`, { method: 'POST', body: { ...DB, spec: swapped({ 'main.s.orders': 'main.s.secret' }) } });
    assert.deepEqual([hidden.status, hidden.data.error], [409, 'Inspire cannot read the columns of main.s.secret with your sign-in: the table does not exist or you cannot read it']);
  });
  await withApp({ me: SP, tokenKind: 'app', forwardedToken: '' }, async (url) => {
    const nobody = await call(url, `/api/inspire/implement/table-change?${Q}`, { method: 'POST', body, who: '' });
    assert.deepEqual([nobody.status, nobody.data.error], [403, NOT_KNOWN]);
    const signedOut = await call(url, `/api/inspire/implement/table-change?${Q}`, { method: 'POST', body });
    assert.deepEqual([signedOut.status, signedOut.data.error], [401, I.IMPLEMENT_TABLES_NO_SIGN_IN]);
  });
});

test('an owner\u2019s compatible swap saves as a settings change with no rebuild, while anyone else\u2019s same swap through Vibe/Add/Remove Features still rebuilds as before', async () => {
  const body = { ...DB, spec: swapped({ 'main.s.orders': 'main.s.orders_v2' }) };
  await withApp({}, async (url, made) => {
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    assert.deepEqual([plan.data.summary.classes, plan.data.summary.refill, plan.data.summary.table_change], [['settings'], false, { class: 'settings', missing: [] }]);
    const sent = await call(url, '/api/inspire/implement/submit', { method: 'POST', body });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    const insert = made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
    assert.equal(insert.parameters.find((p) => p.name === 'classes').value, 'settings');
    assert.ok(made.sqlCalls.some((c) => c.sql === 'SELECT * FROM `main`.`s`.`orders_v2` LIMIT 0' && c.token === 'tok'), 'the App can still read the new table');
  });
  await withApp({}, async (url, made) => {
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body, who: OTHER });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    assert.deepEqual([plan.data.summary.classes, plan.data.summary.refill, plan.data.summary.table_change], [['data'], true, undefined]);
    assert.equal(columnReads(made).length, 0);
  });
  await withApp({ probeErrors: { '`main`.`s`.`orders_v2`': '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`orders_v2` cannot be found.' } }, async (url, made) => {
    const sent = await call(url, '/api/inspire/implement/submit', { method: 'POST', body });
    assert.equal(sent.status, 409, JSON.stringify(sent.data));
    assert.equal(made.jobs.length, 0, 'a settings swap to a table the App cannot read never starts');
  });
});
