// REQ-584 (U9): POST /api/relationships with `tables` and no `table` answers the suggested joins across every pair, in one read per catalog.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const COLS = { 'main.s.orders': ['order_id', 'customer_id', 'status_code'], 'main.s.customers': ['customer_id', 'name'], 'main.s.status_codes': ['status_code', 'label'], 'main.s.job_log': ['order_id', 'run_at'] };
const KEYS = { 'main.s.orders': ['order_id'], 'main.s.customers': ['customer_id'], 'main.s.status_codes': ['status_code'] };
const rowsOf = (fixture, parameters) => parameters.filter((p) => /^s\d+$/.test(p.name))
  .map((p, i) => `main.${p.value}.${parameters.find((x) => x.name === `t${i}`).value}`).filter((n) => fixture[n])
  .flatMap((n) => fixture[n].map((c) => ({ table_schema: 's', table_name: n.split('.')[2], column_name: c })));
const post = (srv, body) => fetch(`${srv.url}/api/relationships?warehouse_id=wh1`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const statements = (extra = {}) => ({
  "constraint_type = 'FOREIGN KEY'": () => ({ rows: [] }),
  "constraint_type = 'PRIMARY KEY'": (sql, parameters) => ({ rows: rowsOf(KEYS, parameters) }),
  'information_schema.columns': (sql, parameters) => ({ rows: rowsOf(COLS, parameters) }),
  ...extra,
});
const TABLES = Object.keys(COLS);

test('REQ-584: the many-table answer holds the joins across every pair, from one columns query per catalog', async () => {
  const made = makeApp({ statements: statements() });
  const srv = await listen(made.app);
  try {
    const { status, body } = await post(srv, { tables: TABLES });
    assert.equal(status, 200, JSON.stringify(body));
    const got = body.suggestions.map((s) => `${s.from.table}.${s.from.column}>${s.to.table}.${s.to.column}`);
    assert.ok(got.includes('main.s.orders.customer_id>main.s.customers.customer_id'), got.join(', '));
    assert.ok(got.includes('main.s.orders.status_code>main.s.status_codes.status_code'));
    assert.ok(got.includes('main.s.job_log.order_id>main.s.orders.order_id'));
    assert.equal(made.sqlCalls.filter((c) => /information_schema\.columns/.test(c.sql)).length, 1);
    assert.deepEqual(body.labels, {}, 'no inspire_database: no labels');
  } finally { srv.close?.(); }
});

test('REQ-584: label rows skip a technical table and keep a reference table a target; a missing label table means no labels', async () => {
  const labelRows = [{ level: 'table', object_fqn: 'main.s.job_log', env: 'prod', label: 'technical' }, { level: 'table', object_fqn: 'main.s.status_codes', env: 'prod', label: 'reference' }];
  const made = makeApp({ statements: statements({ '__inspire_table_labels': () => ({ rows: labelRows }) }) });
  const srv = await listen(made.app);
  try {
    const { body } = await post(srv, { tables: TABLES, inspire_database: 'main.inspire' });
    const got = body.suggestions.map((s) => `${s.from.table}>${s.to.table}`);
    assert.ok(!got.some((p) => p.includes('job_log')), got.join(', '));
    assert.ok(got.includes('main.s.orders>main.s.status_codes'));
    assert.ok(!got.some((p) => p.startsWith('main.s.status_codes>')));
  } finally { srv.close?.(); }
  const broken = makeApp({ statements: statements(), sqlErrors: { '__inspire_table_labels': 'TABLE_OR_VIEW_NOT_FOUND' } });
  const srv2 = await listen(broken.app);
  try {
    const { status, body } = await post(srv2, { tables: TABLES, inspire_database: 'main.inspire' });
    assert.equal(status, 200);
    assert.ok(body.suggestions.some((s) => s.from.table === 'main.s.job_log'), 'with no labels every table counts');
  } finally { srv2.close?.(); }
});

test('must-keep: a bad table name in the list is still refused', async () => {
  const srv = await listen(makeApp({ statements: statements() }).app);
  try {
    assert.equal((await post(srv, { tables: ['orders'] })).status, 400);
  } finally { srv.close?.(); }
});
