// rc13 metric views (REQ-128, close-out): a route that reads a picked table's rows refuses a metric view with one plain line
// (400), before any read of its rows. A table that is not a metric view is read as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const VIEW = 'main.s.customer_value_metrics';
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '' };
const BUILT = { session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: 'owner@example.com', updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify({ use_case_id: 'N01-U01', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: {} }),
  asset_status: JSON.stringify({}) };
const REFUSAL = `${VIEW} is a metric view, so Inspire leaves it out of Data Filters; pick its source table instead`;

async function call(base, url, { method = 'GET', body } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
    body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, run) {
  const made = makeApp({ useCase: USE_CASE, history: [BUILT], metricViews: [VIEW], ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    srv.close?.();
  }
}

const readsOf = (made, pattern) => made.sqlCalls.filter((c) => pattern.test(String(c.sql)));

const ROUTES = [
  ['columns', (url) => call(url, `/api/inspire/implement/columns?${Q}&table=${VIEW}`), /information_schema\.columns/],
  ['values', (url) => call(url, `/api/inspire/implement/values?${Q}&table=${VIEW}&column=region`), /SELECT DISTINCT CAST/],
  ['readiness', (url) => call(url, `/api/inspire/implement/readiness?${Q}`, { method: 'POST', body: { table: VIEW, columns: [], filters: [], window: {} } }), /SELECT COUNT\(\*\) AS row_count/],
  ['group-counts', (url) => call(url, `/api/inspire/implement/group-counts?${Q}`, { method: 'POST', body: { table: VIEW, columns: ['region'], filters: [], window: {} } }), / AS records FROM /],
];

for (const [name, request, rowRead] of ROUTES) {
  test(`the ${name} route refuses a metric view with one plain line, before it reads the rows (REQ-128)`, async () => {
    await withApp({}, async (url, made) => {
      const got = await request(url);
      assert.equal(got.status, 400, JSON.stringify(got.data));
      assert.equal(got.data.error, REFUSAL, 'one plain line, not a SQL error');
      assert.deepEqual(readsOf(made, rowRead), [], `the ${name} route never reads the metric view's rows`);
    });
  });
}

test('a table that is not a metric view is read as before, so the columns route still answers', async () => {
  await withApp({ columnsByTable: { 'main.s.orders': [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }] } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/columns?${Q}&table=main.s.orders`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.columns[0].column_name, 'order_id');
    assert.equal(readsOf(made, /information_schema\.tables/).length, 1, 'one type check, then the read');
  });
});

test('the refusal line is the one the lib builds, so the route and the App say the same thing', () => {
  const M = require('../lib/metricViews');
  assert.equal(M.metricViewRefusal(VIEW), REFUSAL);
  assert.equal(typeof I.tableTypeStatement, 'function');
  const stmt = I.tableTypeStatement('main.s.customer_value_metrics');
  assert.match(stmt.sql, /information_schema\.tables/);
  assert.deepEqual(stmt.parameters.map((p) => [p.name, p.value]), [['s', 's'], ['t', 'customer_value_metrics']]);
});
