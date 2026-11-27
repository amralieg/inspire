const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

// c29_history: reads that do not depend on one another run together, not one after the other. A plan over many source tables reads each
// table's Unity Catalog info (the row filter and column mask check); those reads must overlap.
const TABLES = Array.from({ length: 8 }, (_, i) => `main.s.t${i + 1}`);
const COLUMNS = [
  { column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 },
  { column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 2 },
];

test('a plan over 8 source tables reads their table info in parallel, with the same answer (c29_history)', async () => {
  const spans = [];
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Predict churn', primary_table: TABLES[0], tables_involved: TABLES.join(', ') },
    columns: COLUMNS,
    workspace: async ({ path }) => {
      if (!/^\/api\/2\.1\/unity-catalog\/tables\/[^/?]+$/.test(path)) return undefined;
      const span = { start: Date.now(), end: 0 };
      spans.push(span);
      await new Promise((done) => setTimeout(done, 40));
      span.end = Date.now();
      return undefined;
    },
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: {
        use_case_id: 'N01-U01', use_case_name: 'Predict churn',
        config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
        outputs: { dashboard: true, genie_space: false, alert: false, app: false },
        data: { table_scope: Object.fromEntries(TABLES.map((t) => [t, { columns: ['order_id', 'amount'], rows: [] }])) },
      } }) });
    assert.equal(resp.status, 200, JSON.stringify(await resp.json()).slice(0, 300));
    // The route reads each source table twice over (once to check access, once for its policy); the last N reads are the policy check.
    assert.ok(spans.length >= TABLES.length, `every source table info is read, got ${spans.length}`);
    const policy = spans.slice(-TABLES.length);
    const overlapping = policy.filter((a, i) => policy.some((b, k) => k !== i && a.start < b.end && b.start < a.end)).length;
    assert.ok(overlapping > 1, `the policy table-info reads overlap, ${overlapping} of ${policy.length} did`);
  } finally {
    await srv.close();
  }
});
