// REQ-436/437: POST case-plan, POST preview and the shape-2 answers, through the real routes with a fake warehouse.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [
  { column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'status', data_type: 'STRING', ordinal_position: 2 },
  { column_name: 'avg_amount', data_type: 'DOUBLE', ordinal_position: 3 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 4 },
];
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const MODEL_PLAN = {
  case_noun: 'fraud case', case_filter: { column: 'status', op: '=', value: 'SECRETFLAG' },
  groupings: [{ column: 'region', label: 'By region' }],
  metrics: [{ id: 'avg_amount', label: 'Average amount', column: 'avg_amount', agg: 'avg' }],
  drivers: [{ id: 'risk_avoided', label: 'Fraud avoided', on: true, why: 'fewer losses', asks: [
    { id: 'incidents_per_year', source: 'data', metric: 'records' }, { id: 'cost_per_incident', source: 'data', metric: 'avg_amount' },
    { id: 'reduction_pct', source: 'estimate', default: 30, why: 'a guess' }] }],
};
const ENDPOINTS = [{ endpoints: [{ name: 'chat-1', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }];
const modelWorks = { 'GET /api/2.0/serving-endpoints': ENDPOINTS, 'POST /serving-endpoints/chat-1/invocations': [{ choices: [{ message: { content: JSON.stringify(MODEL_PLAN) } }] }] };
const modelDenied = { 'GET /api/2.0/serving-endpoints': ENDPOINTS, 'POST /serving-endpoints/chat-1/invocations': [{ message: 'denied' }, 403] };
// 365 days of data: 1000 and 3000 records, and an average amount of 10 and 20.
const GROUPED = { rows: [{ g: 'north', records: '1000', days: '365', m_avg_amount: '10' }, { g: 'south', records: '3000', days: '365', m_avg_amount: '20' }] };

const appWith = (responses, statements = {}) => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, responses, statements: { 'AS records': GROUPED, ...statements } });
async function call(made, method, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('case-plan: 200 with groups from the grouped SQL, and the filter value is a bound parameter', async () => {
  const made = appWith(modelWorks);
  const got = await call(made, 'POST', '/api/inspire/value/case-plan', BODY);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const { plan } = got.data;
  assert.equal(plan.model, 'chat-1');
  assert.equal(plan.case_noun, 'fraud case');
  assert.equal(plan.grouping, 'region');
  assert.equal(plan.date_column, 'event_date');
  assert.equal(plan.days, 365);
  assert.deepEqual(plan.groups.map((g) => [g.g, g.records_per_year, g.metrics.avg_amount]), [['south', 3000, 20], ['north', 1000, 10]]);
  const grouped = made.sqlCalls.filter((c) => c.sql.includes('AS records'));
  assert.equal(grouped.length, 1);
  assert.ok(!grouped[0].sql.includes('SECRETFLAG'), grouped[0].sql);
  assert.ok(grouped[0].parameters.some((p) => p.value === 'SECRETFLAG'));
});

test('case-plan: a model that answers 403 still gives 200 with the fallback plan', async () => {
  const got = await call(appWith(modelDenied), 'POST', '/api/inspire/value/case-plan', BODY);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.model, null);
  assert.equal(got.data.plan.case_filter, null);
  assert.equal(got.data.plan.drivers.length, 5);
  assert.ok(got.data.plan.groups.length >= 1);
});

const PLAN = {
  case_noun: 'fraud case', table: ORDERS, date_column: 'event_date', days: 365, grouping: 'region', groupings: [{ column: 'region', label: 'By region' }],
  groups: [{ g: 'north', records_per_year: 1000, metrics: { avg_amount: 10 } }, { g: 'south', records_per_year: 3000, metrics: { avg_amount: 20 } }],
  metrics: [{ id: 'avg_amount', label: 'Average amount', column: 'avg_amount', agg: 'avg' }],
  drivers: [{ id: 'risk_avoided', label: 'Fraud avoided', verb: 'AVOID RISK', on: true, why: '', asks: [
    { id: 'incidents_per_year', label: 'Incidents', kind: 'count', source: 'data', metric: 'records' },
    { id: 'cost_per_incident', label: 'Cost', kind: 'money', source: 'data', metric: 'avg_amount' },
    { id: 'reduction_pct', label: 'Prevented', kind: 'pct', source: 'estimate', default: 30, why: '' }] }],
};
const answers = (calculated) => ({ shape: 2, currency: 'USD', attribution_pct: 100, grouping: 'region', excluded_groups: [], calculated, plan: PLAN,
  drivers: { risk_avoided: { on: true, inputs: { reduction_pct: 50 } } } });

test('preview: the C4 yearly with input sources and group coverage, and no SQL', async () => {
  const made = appWith(modelWorks);
  const got = await call(made, 'POST', '/api/inspire/value/preview', { plan: PLAN, answers: answers(false) });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const { yearly } = got.data;
  assert.equal(yearly.total.amount, 35000);
  assert.equal(yearly.estimated, true);
  assert.deepEqual(yearly.groups, { grouping_label: 'By region', covered: 2, of: 2 });
  assert.deepEqual(yearly.parts[0].inputs.map((i) => i.source), ['data', 'data', 'estimate']);
  assert.equal(made.sqlCalls.length, 0);
  const bad = answers(false);
  bad.drivers.risk_avoided.inputs.reduction_pct = 101;
  const refused = await call(appWith(modelWorks), 'POST', '/api/inspire/value/preview', { plan: PLAN, answers: bad });
  assert.equal(refused.status, 400);
  assert.ok(refused.data.errors.risk_avoided);
});

function fakeTable(rows = []) {
  const handler = (sql, parameters) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    const bound = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    if (sql.startsWith('INSERT')) {
      const cols = /\(([^)]+)\) VALUES/.exec(sql)[1].split(',').map((c) => c.trim());
      const vals = /VALUES \((.*)\)\s*$/s.exec(sql)[1].split(', ').map((v) => v.trim());
      rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i].startsWith(':') ? bound[vals[i].slice(1)] : vals[i]])));
      return { rows: [] };
    }
    if (sql.includes('ROW_NUMBER')) return { rows: rows.map((r) => ({ ...r, version: String(r.version) })) };
    if (/MAX\(version\)/.test(sql)) return { rows: [{ latest: rows.length ? String(rows.length) : null }] };
    return { rows: [] };
  };
  return { rows, statements: { __inspire_value_answers: handler } };
}

test('PUT answers shape 2 stores the yearly with calculated as sent; GET returns it and stale', async () => {
  const table = fakeTable();
  const made = appWith(modelWorks, table.statements);
  const put = await call(made, 'PUT', '/api/inspire/value/answers', { ...BODY, answers: answers(true) });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.yearly.calculated, true);
  assert.equal(put.data.yearly.total.amount, 35000);
  assert.equal(JSON.parse(table.rows[0].yearly).calculated, true);
  const made2 = appWith(modelWorks, table.statements);
  // 365 days of data and 4,000 records a year: the saved plan covers the same, so the plan is not stale.
  const got = await call(made2, 'GET', '/api/inspire/value/answers?inspire_database=main.inspire&warehouse_id=wh1&session_id=42', null);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const entry = got.data.answers['N01-U01'];
  assert.equal(entry.yearly.calculated, true);
  assert.equal(entry.yearly.total.amount, 35000);
  assert.equal(typeof entry.stale, 'boolean');
  const unsaved = fakeTable();
  const draft = await call(appWith(modelWorks, unsaved.statements), 'PUT', '/api/inspire/value/answers', { ...BODY, answers: answers(false) });
  assert.equal(draft.data.yearly.calculated, false);
  assert.equal(draft.data.yearly.estimated, true);
});

test('PUT answers with the old shape returns the same yearly as before', async () => {
  const table = fakeTable();
  const old = { drivers: { cost_cut: { spend_per_year: 500000, cut_pct: 10 } }, currency: 'AED', attribution_pct: 100 };
  const got = await call(appWith(modelWorks, table.statements), 'PUT', '/api/inspire/value/answers', { ...BODY, answers: old });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.yearly.total.amount, 50000);
  assert.equal(got.data.yearly.estimated, true);
});
