// SEC-01 AT10, Build half (W8, D5): a source with a row filter keeps that filter on the result, so the filter's column must be in the
// result. A plan whose Table Scope drops that column is refused at plan time, with a plain message, before any job (never at run time).
// The row filter is read from the source's Unity Catalog table info (row_filter.input_column_names, as lakebaseEnforce.js reads it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const SOURCE = 'main.s.orders';
const FILTER = { function_name: 'main.s.region_filter', input_column_names: ['region'] };
const specKeeping = (columns) => ({
  use_case_id: 'N01-U01', use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: false, alert: false, app: false },
  data: { table_scope: { [SOURCE]: { columns, rows: [] } } },
});

async function plan(columns, route = '/api/inspire/implement/plan') {
  const made = makeApp({
    useCase: { id: 'N01-U01', use_case: 'Predict churn', primary_table: SOURCE, tables_involved: SOURCE },
    columns: [
      { column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 },
      { column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 2 },
      { column_name: 'region', data_type: 'STRING', ordinal_position: 3 },
    ],
    rowFilters: { [SOURCE]: FILTER },
    policies: { [SOURCE]: [{ policy_type: 'POLICY_TYPE_ROW_FILTER', row_filter: { function_name: FILTER.function_name } }] },
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(srv.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: specKeeping(columns) }) });
    return { status: resp.status, data: await resp.json(), made };
  } finally {
    await srv.close();
  }
}

test('AT10: a Build plan whose result drops the row filter column of a policied source is refused at plan time', async () => {
  const got = await plan(['order_id', 'amount']);
  assert.ok(got.status >= 400 && got.status < 500,
    `AT10: Not implemented: the plan is not refused (${got.status}) although ${SOURCE} has a row filter on region and the result drops region: ${JSON.stringify(got.data).slice(0, 400)}`);
  const message = String(got.data.error || got.data.message || '');
  assert.match(message, /region/, `AT10: the plain message names the filter column: ${message}`);
  assert.match(message, /main\.s\.orders/, `AT10: the plain message names the source: ${message}`);
  assert.equal(got.made.jobs.length, 0, 'AT10: no job starts');
});

test('AT10: submit refuses the same spec before any job starts', async () => {
  const got = await plan(['order_id', 'amount'], '/api/inspire/implement/submit');
  assert.equal(got.made.jobs.length, 0, `AT10: Not implemented: submit started a job for a result that drops the row filter column: ${JSON.stringify(got.data).slice(0, 300)}`);
  assert.ok(got.status >= 400 && got.status < 500, `AT10: submit is refused: ${got.status}`);
});

test('AT10 control: a plan that keeps the row filter column is not refused for it', async () => {
  const got = await plan(['order_id', 'amount', 'region']);
  assert.equal(got.status, 200, JSON.stringify(got.data).slice(0, 400));
});
