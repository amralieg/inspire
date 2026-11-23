// REQ-507 L1 (routes): POST /api/inspire/value/scope (records found, before any money), POST /api/inspire/value/filter (plain English to
// structure to bound SQL, with the security gate), case-plan taking the chosen scope (the model filter is only a suggestion), the anchor seeing
// the record count, likely_value.currency following the answers, and the story approval stamped by the server. Fake workspace, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [
  { column_name: 'region_name', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'status', data_type: 'STRING', ordinal_position: 2 },
  { column_name: 'order_type', data_type: 'STRING', ordinal_position: 3 }, { column_name: 'avg_amount', data_type: 'DOUBLE', ordinal_position: 4 },
  { column_name: 'transaction_time', data_type: 'TIMESTAMP', ordinal_position: 5 }, { column_name: 'shipped_at', data_type: 'DATE', ordinal_position: 6 },
];
const NO_DATES = COLUMNS.filter((c) => !/^(date|timestamp)/i.test(c.data_type));
const BASE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const ENDPOINTS = { endpoints: [{ name: 'chat-1', state: { ready: 'READY' }, task: 'llm/v1/chat' }] };
const chat = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

const MODEL_PLAN = {
  case_noun: 'transaction', case_filter: { column: 'status', op: '=', value: 'SECRETFLAG' },
  groupings: [{ column: 'region_name', label: 'By region' }],
  metrics: [{ id: 'avg_amount', label: 'Average amount', column: 'avg_amount', agg: 'avg' }],
  drivers: [{ id: 'risk_avoided', label: 'Losses avoided', on: true, why: 'fewer losses', asks: [
    { id: 'incidents_per_year', source: 'data', metric: 'records' }, { id: 'cost_per_incident', source: 'data', metric: 'avg_amount' },
    { id: 'reduction_pct', source: 'estimate', default: 30, why: 'a guess' }] }],
};
const ANCHOR = { low: 100000, high: 5000000, typical: 900000, business_revenue_estimate: 900000000, reason: 'mid-size business', economic_factors: [] };

// The fake model answers by the prompt it gets: the anchor, the plan, the review, or the filter (state.filterReply).
function modelOf(state) {
  return ({ path, method, body }) => {
    if (method === 'GET' && path.startsWith('/api/2.0/serving-endpoints')) return [ENDPOINTS];
    if (method !== 'POST' || !path.startsWith('/serving-endpoints/')) return undefined;
    state.prompts.push(body.messages);
    if (state.modelDown) return [{ message: 'denied' }, 403];
    const system = String(body.messages[0].content);
    if (/^You anchor/.test(system)) return [chat(ANCHOR)];
    if (/^You review/.test(system)) return [chat({ approved: true, amount: 1, reason: 'plausible' })];
    if (/^You plan/.test(system)) return [chat(MODEL_PLAN)];
    return [state.filterReply];
  };
}

// The warehouse: the scope facts row, the before/after count, the grouped rows and the population count of orders.
const FACTS = { rows_total: '3412880', dated_rows: '3400840', first_day: '2019-01-01T00:00:00.000Z', last_day: '2026-09-30T18:00:00.000Z',
  c0_first: '2019-01-01T00:00:00.000Z', c0_last: '2026-09-30T18:00:00.000Z', c1_first: '2019-01-03', c1_last: '2026-10-02' };
const COUNTS = { rows_before: '3412880', rows_after: '1198406' };
const GROUPED = { rows: [{ g: 'north', records: '1000', days: '365', m_avg_amount: '10' }, { g: 'south', records: '3000', days: '365', m_avg_amount: '20' }] };
const POPULATION = { rows: [{ records: '4000', days: '365' }] };
function ordersRead(sql) {
  if (sql.includes('rows_before')) return { rows: [COUNTS] };
  if (sql.includes(' AS g')) return GROUPED;
  if (sql.includes('AS records')) return POPULATION;
  return { rows: [FACTS] };
}

function appWith({ filterReply = null, modelDown = false, columns = COLUMNS, statements = {} } = {}) {
  const state = { prompts: [], filterReply, modelDown };
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns, workspace: modelOf(state), statements: { 'orders`': ordersRead, ...statements } });
  return { ...made, model: state };
}
async function call(made, method, route, body, email = 'person@example.com') {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': email }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } finally {
    await srv.close();
  }
}
const ordersCalls = (made) => made.sqlCalls.filter((c) => c.sql.includes('orders`'));
const reached = (made, needle) => made.sqlCalls.some((c) => `${c.sql} ${JSON.stringify(c.parameters || [])}`.includes(needle));

// ---- POST /value/scope ----

test('L1 scope: records found, dated rows, first and last day and every date column, before any model call or money', async () => {
  const made = appWith();
  const got = await call(made, 'POST', '/api/inspire/value/scope', BASE);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.facts, { table: ORDERS, rows: 3412880, dated_rows: 3400840, first: '2019-01-01', last: '2026-09-30', date_column: 'transaction_time',
    date_candidates: [{ column: 'transaction_time', first: '2019-01-01', last: '2026-09-30' }, { column: 'shipped_at', first: '2019-01-03', last: '2026-10-02' }] });
  assert.equal(made.model.prompts.length, 0, 'no model call to show the records found');
  assert.ok(!JSON.stringify(got.data).match(/likely_value|amount/), 'no money in the scope reply');
  const reads = ordersCalls(made);
  assert.equal(reads.length, 1, 'one read-only count');
  assert.match(reads[0].sql, /^(SELECT|WITH) /);
  assert.doesNotMatch(reads[0].sql, /;/);
});

test('L1 scope: the person can change the date column; an unknown one is refused before the warehouse', async () => {
  const picked = await call(appWith(), 'POST', '/api/inspire/value/scope', { ...BASE, date_column: 'shipped_at' });
  assert.equal(picked.status, 200, JSON.stringify(picked.data));
  assert.equal(picked.data.facts.date_column, 'shipped_at');
  const made = appWith();
  const bad = await call(made, 'POST', '/api/inspire/value/scope', { ...BASE, date_column: 'nope`; DROP TABLE x' });
  assert.equal(bad.status, 400);
  assert.equal(ordersCalls(made).length, 0);
});

test('L1 scope: a table with no date column still answers (200) with the rows and no dates, instead of today\'s 422', async () => {
  const got = await call(appWith({ columns: NO_DATES, statements: { 'orders`': () => ({ rows: [{ rows_total: '500', dated_rows: '0', first_day: null, last_day: null }] }) } }),
    'POST', '/api/inspire/value/scope', BASE);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.facts.rows, 500);
  assert.equal(got.data.facts.date_column, null);
  assert.deepEqual(got.data.facts.date_candidates, []);
});

// ---- POST /value/filter ----

const GOOD_REPLY = chat({ filters: [{ column: 'order_type', op: '!=', values: ['test'] }], window: { column: 'transaction_time', last_n: 1, unit: 'year' },
  echo: 'MODEL_ECHO_TEXT', unmatched: [] });

test('L1 filter: a phrase becomes bound SQL, the window resolves to MAX(date) minus 1 year, before/after counts and an echo built from the structure', async () => {
  const made = appWith({ filterReply: GOOD_REPLY });
  const got = await call(made, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', phrase: 'Only include transactions from the last 1 year and leave out test orders' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const { scope } = got.data;
  assert.deepEqual(scope.filters, [{ column: 'order_type', op: '!=', values: ['test'] }]);
  assert.deepEqual(scope.window, { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30', last_n: 1, unit: 'year' });
  assert.equal(scope.rows_before, 3412880);
  assert.equal(scope.rows_after, 1198406);
  assert.match(scope.phrase, /last 1 year/);
  assert.match(got.data.echo, /transaction_time is from 1 Oct 2025 to 30 Sep 2026/);
  assert.match(got.data.echo, /1,198,406 of 3,412,880 rows/);
  assert.doesNotMatch(got.data.echo, /MODEL_ECHO_TEXT/);
  const count = made.sqlCalls.filter((c) => c.sql.includes('rows_before'));
  assert.equal(count.length, 1, 'before and after come from one statement');
  assert.ok(!count[0].sql.includes("'test'") && !count[0].sql.includes('2025-10-01'), count[0].sql);
  assert.match(String(got.data.sql || ''), /COUNT_IF/, 'the SQL Inspire ran is returned to show collapsed');
  const prompt = made.model.prompts[0].map((m) => m.content).join('\n');
  for (const c of COLUMNS) assert.ok(prompt.includes(c.column_name), `the prompt lists ${c.column_name}`);
});

for (const [name, content] of [
  ['SQL text instead of structure', { sql: 'SELECT COUNT(*) FROM main.s.orders' }],
  ['a DDL keyword in a value', { filters: [{ column: 'status', op: '=', values: ["x'; DROP TABLE main.s.orders; --"] }], window: null, unmatched: [] }],
  ['a DDL keyword in a column', { filters: [{ column: 'status; DROP TABLE main.s.orders', op: '=', values: ['x'] }], window: null, unmatched: [] }],
  ['an operator that is SQL text', { filters: [{ column: 'status', op: '= 1 OR 1=1 --', values: ['x'] }], window: null, unmatched: [] }],
]) {
  test(`L1 security: a model reply with ${name} is rejected (422) and never reaches the warehouse`, async () => {
    const made = appWith({ filterReply: chat(content) });
    const got = await call(made, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', phrase: 'only paid ones' });
    assert.equal(got.status, 422, JSON.stringify(got.data));
    assert.ok(String(got.data.error || '').length > 0);
    assert.equal(made.sqlCalls.filter((c) => c.sql.includes('rows_before')).length, 0, 'no count ran');
    assert.ok(!reached(made, 'DROP'), 'DROP never reached the warehouse');
    assert.ok(!reached(made, '1=1'), 'the forged operator never reached the warehouse');
  });
}

test('L1 security: an unknown column is reported as unmatched with close names and never reaches the warehouse', async () => {
  const made = appWith({ filterReply: chat({ filters: [{ column: 'region', op: 'in', values: ['North'] }], window: null, unmatched: ['top 3 regions'] }) });
  const got = await call(made, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', phrase: 'Only the top 3 regions, North' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.scope.filters, []);
  const region = got.data.unmatched.find((u) => u.column === 'region');
  assert.ok(region && region.close.includes('region_name'), JSON.stringify(got.data.unmatched));
  assert.ok(got.data.unmatched.some((u) => u.phrase === 'top 3 regions'));
  assert.ok(!made.sqlCalls.some((c) => c.sql.includes('`region`')), 'the unknown column is not in any SQL');
});

test('L1 filter: with the model down the reply asks for the structured builder (200, builder true), and the builder posts structure through the same gate', async () => {
  const down = appWith({ modelDown: true });
  const got = await call(down, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', phrase: 'only paid ones' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.builder, true);
  assert.equal(got.data.scope, null);
  const made = appWith();
  const built = await call(made, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', filters: [{ column: 'status', op: '=', values: ['paid'] }] });
  assert.equal(built.status, 200, JSON.stringify(built.data));
  assert.equal(made.model.prompts.length, 0, 'structured filters need no model');
  assert.equal(built.data.scope.rows_after, 1198406);
  const forged = appWith();
  const refused = await call(forged, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', filters: [{ column: 'status', op: '=', values: ["x'; DROP TABLE main.s.orders; --"] }] });
  assert.ok(refused.status === 400 || refused.status === 422, `refused: ${refused.status}`);
  assert.ok(!reached(forged, 'DROP'));
});

test('L1 filter: the "Last 12 months" card posts a structured window with no phrase; it resolves against the last day in the data, no model', async () => {
  const made = appWith();
  const got = await call(made, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', filters: [], window: { column: 'transaction_time', last_n: 12, unit: 'month' } });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(made.model.prompts.length, 0);
  assert.deepEqual(got.data.scope.window, { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30', last_n: 12, unit: 'month' });
  const bad = appWith();
  const refused = await call(bad, 'POST', '/api/inspire/value/filter', { ...BASE, date_column: 'transaction_time', filters: [], window: { column: 'transaction_time', last_n: '1; DELETE FROM x', unit: 'year' } });
  assert.ok(refused.status === 400 || refused.status === 422, `refused: ${refused.status}`);
  assert.ok(!reached(bad, 'DELETE'));
});

// ---- case-plan with the chosen scope ----

const SCOPE = { phrase: 'leave out test orders', filters: [{ column: 'order_type', op: '!=', values: ['test'] }], window: { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30' },
  rows_before: 3412880, rows_after: 1198406, first: '2025-10-01', last: '2026-09-30' };

test('L1 case-plan: with a scope, the grouped and population counts read only the scoped rows; the model filter is a suggestion, never applied', async () => {
  const made = appWith();
  const got = await call(made, 'POST', '/api/inspire/value/case-plan', { ...BASE, scope: SCOPE });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const { plan } = got.data;
  assert.equal(plan.case_filter, null, 'the model filter is not applied silently');
  assert.deepEqual(plan.suggested_filter, { column: 'status', op: '=', value: 'SECRETFLAG' });
  assert.deepEqual(plan.scope.filters, SCOPE.filters);
  assert.deepEqual(plan.scope.window, { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30' });
  const counted = made.sqlCalls.filter((c) => c.sql.includes('AS records'));
  assert.ok(counted.length >= 2, 'grouped and population counts ran');
  for (const c of counted) {
    assert.ok(!c.sql.includes('SECRETFLAG') && !(c.parameters || []).some((p) => p.value === 'SECRETFLAG'), 'the suggestion is not in the count');
    assert.ok((c.parameters || []).some((p) => p.value === 'test'), `scoped: ${c.sql}`);
    assert.ok((c.parameters || []).some((p) => p.value === '2025-10-01'), `windowed: ${c.sql}`);
  }
});

test('L1 case-plan: a forged scope from the browser is checked again (unknown column or SQL text is refused before the warehouse)', async () => {
  const made = appWith();
  const got = await call(made, 'POST', '/api/inspire/value/case-plan', { ...BASE, scope: { ...SCOPE, filters: [{ column: 'status`) OR 1=1 --', op: '=', values: ['x'] }] } });
  assert.equal(got.status, 400, JSON.stringify(got.data));
  assert.ok(!reached(made, '1=1'));
});

test('L1 case-plan: the anchor prompt includes the records per year of the scope, and likely_value.currency follows the answers', async () => {
  const made = appWith();
  const got = await call(made, 'POST', '/api/inspire/value/case-plan', { ...BASE, scope: SCOPE, currency: 'AED' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const anchor = made.model.prompts.find((m) => /^You anchor/.test(String(m[0].content)));
  assert.ok(anchor, 'the anchor was asked');
  assert.match(anchor.map((m) => m.content).join('\n'), /Records per year in the use case table: 4000/);
  assert.equal(got.data.plan.likely_value.currency, 'AED');
});

// ---- the story approval is stamped by the server ----

test('L1 answers: a saved story approval carries the signed-in person and the server time, never the browser\'s', async () => {
  const rows = [];
  const handler = (sql, parameters) => {
    const bound = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    if (sql.startsWith('INSERT')) {
      const cols = /\(([^)]+)\) VALUES/.exec(sql)[1].split(',').map((c) => c.trim());
      const vals = /VALUES \((.*)\)\s*$/s.exec(sql)[1].split(', ').map((v) => v.trim());
      rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i].startsWith(':') ? bound[vals[i].slice(1)] : vals[i]])));
    }
    if (/MAX\(version\)/.test(sql)) return { rows: [{ latest: null }] };
    return { rows: [] };
  };
  const PLAN = { case_noun: 'transaction', table: ORDERS, date_column: 'transaction_time', days: 365, grouping: 'region_name', groupings: [],
    groups: [{ g: 'north', records_per_year: 1000, metrics: {} }], metrics: [],
    drivers: [{ id: 'cost_cut', label: 'Fees avoided', verb: 'REDUCE COST', on: true, why: '', asks: [
      { id: 'spend_per_year', label: 'Spend', kind: 'money', source: 'estimate', default: 500000, why: '' }, { id: 'cut_pct', label: 'Cut', kind: 'pct', source: 'estimate', default: 10, why: '' }] }] };
  const answers = { shape: 2, currency: 'USD', attribution_pct: 100, grouping: 'region_name', excluded_groups: [], calculated: true, plan: PLAN,
    drivers: { cost_cut: { on: true, inputs: { spend_per_year: 500000, cut_pct: 10 } } },
    story: { text: 'Save 50,000 a year.', params_hash: 'abc123', include_in_docs: true, approved: true, approved_by: 'forged@example.com', approved_at: '1999-01-01T00:00:00Z' } };
  const made = appWith({ statements: { __inspire_value_answers: handler } });
  const before = Date.now();
  const got = await call(made, 'PUT', '/api/inspire/value/answers', { ...BASE, answers });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const story = JSON.parse(rows[0].answers).story;
  assert.equal(story.approved_by, 'person@example.com');
  assert.ok(Date.parse(story.approved_at) >= before - 1000, story.approved_at);
  assert.equal(story.include_in_docs, true);
  assert.equal(story.text, 'Save 50,000 a year.');
});
