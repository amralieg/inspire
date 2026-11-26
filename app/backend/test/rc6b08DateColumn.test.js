// RC6-B-08: one date-column detector for the single-case dialog and the bulk run; a real skip names the table and the columns checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const VY = require('../lib/valueYearly');
const { makeApp, listen } = require('./support/implementApp');

const col = (column_name, data_type, ordinal_position = 1) => ({ column_name, data_type, ordinal_position });

test('a column named dateTime is found whether it is TIMESTAMP, DATE or STRING', () => {
  assert.equal(VY.dateColumnOf([col('amount', 'DOUBLE'), col('dateTime', 'TIMESTAMP')]), 'dateTime');
  assert.equal(VY.dateColumnOf([col('amount', 'DOUBLE'), col('dateTime', 'DATE')]), 'dateTime');
  assert.equal(VY.dateColumnOf([col('amount', 'DOUBLE'), col('dateTime', 'STRING')]), 'dateTime');
});

test('a typed date column still wins over a string named like a date; a table with none has no date column', () => {
  assert.equal(VY.dateColumnOf([col('order_date_text', 'STRING'), col('shipped', 'DATE')]), 'shipped');
  assert.equal(VY.dateColumnOf([col('amount', 'DOUBLE'), col('name', 'STRING')]), '');
  assert.deepEqual(VY.dateColumnsOf([col('dateTime', 'STRING'), col('x', 'INT')]).map((c) => c.column_name), ['dateTime']);
});

const ORDERS = 'main.s.sales';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };

async function plan(columns) {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns, statements: {} });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/case-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BODY) });
    return { status: resp.status, error: String((await resp.json().catch(() => ({}))).error || '') };
  } finally {
    await srv.close();
  }
}

test('case-plan on a table with no date column is a 422 that names the table and the columns it checked', async () => {
  const got = await plan([col('amount', 'DOUBLE', 1), col('region', 'STRING', 2)]);
  assert.equal(got.status, 422);
  assert.match(got.error, /main\.s\.sales/);
  assert.match(got.error, /amount/);
  assert.match(got.error, /region/);
});

test('case-plan on a table dated by a STRING dateTime does not skip for "no date column"', async () => {
  const got = await plan([col('amount', 'DOUBLE', 1), col('dateTime', 'STRING', 2)]);
  assert.doesNotMatch(got.error, /no date column/i);
});
