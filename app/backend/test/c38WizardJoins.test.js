// c38 (REQ-584 U9): the wizard suggests joins across ALL selected tables by name (the rules relationships.js already has for one table),
// skips dev and technical tables, keeps prod reference tables as join targets, and sends a suggestion the person removed as an entry
// with "removed": true in 18_table_relationships, so the agent drops that pair from its own inferred keys.
// Must-fail: relationshipsAcross does not exist, and the launch check and launch text drop the removed flag before c38.
// Must-keep: a join with no flag is sent exactly as today; a malformed entry is still refused.
const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../lib/relationships');
const { sanitizeInspireNotebookJobParams: validateInspireJobParams } = require('../lib/inspireJobParams');

const cols = (table, names) => names.map((column_name) => ({ table, column_name }));
const SCOPE = {
  columns: [
    ...cols('main.s.orders', ['order_id', 'customer_id', 'status_code', 'amount']),
    ...cols('main.s.customers', ['customer_id', 'name', 'country_code']),
    ...cols('main.s.order_lines', ['order_id', 'line_no', 'product_id']),
    ...cols('main.s.products', ['product_id', 'name']),
    ...cols('main.s.status_codes', ['status_code', 'label']),
    ...cols('main.s.job_log', ['order_id', 'run_at']),
  ],
  keys: [
    ...cols('main.s.orders', ['order_id']), ...cols('main.s.customers', ['customer_id']), ...cols('main.s.products', ['product_id']),
    ...cols('main.s.status_codes', ['status_code']),
  ],
};
const pairs = (out) => out.suggestions.map((s) => `${s.from.table}.${s.from.column}>${s.to.table}.${s.to.column}`).sort();

test('REQ-584: joins are suggested across every pair of the selected tables, not only one picked table (must-fail before c38)', () => {
  assert.equal(typeof R.relationshipsAcross, 'function');
  const out = R.relationshipsAcross(SCOPE);
  const got = pairs(out);
  for (const want of [
    'main.s.orders.customer_id>main.s.customers.customer_id',
    'main.s.order_lines.order_id>main.s.orders.order_id',
    'main.s.order_lines.product_id>main.s.products.product_id',
    'main.s.orders.status_code>main.s.status_codes.status_code',
  ]) assert.ok(got.includes(want), `${want} in ${got.join(', ')}`);
  assert.equal(new Set(got).size, got.length, 'each join once');
  assert.ok(out.suggestions.every((s) => s.source === R.SOURCE_NAME || s.source === R.SOURCE_DECLARED));
  assert.ok(!got.some((p) => /\.name>|>.*\.name$/.test(p)), 'a generic column name is never a join by itself');
});

test('REQ-584 / REQ-583: dev and technical tables get no suggestion; a prod reference table is a join target', () => {
  const labels = { 'main.s.job_log': { env: 'prod', label: 'technical' }, 'main.s.products': { env: 'dev', label: 'master' }, 'main.s.status_codes': { env: 'prod', label: 'reference' } };
  const got = pairs(R.relationshipsAcross({ ...SCOPE, labels }));
  assert.ok(!got.some((p) => p.includes('main.s.job_log') || p.includes('main.s.products')), got.join(', '));
  assert.ok(got.includes('main.s.orders.status_code>main.s.status_codes.status_code'));
  assert.ok(!got.some((p) => p.startsWith('main.s.status_codes.')), 'a reference table is a target, never the foreign-key side');
});

const BASE = { '00_business_name': 'Example Co', '01_uc_metadata': 'main.s', '02_inspire_database': 'main.inspire', '15_operation': 'Discover Use Cases' };
const join = (f, fc, t, tc, extra = {}) => ({ from: { table: f, column: fc }, to: { table: t, column: tc }, ...extra });

test('REQ-584: a suggestion the person removed reaches the job as "removed": true (must-fail before c38)', () => {
  const sent = [join('main.s.orders', 'customer_id', 'main.s.customers', 'customer_id'), join('main.s.job_log', 'order_id', 'main.s.orders', 'order_id', { removed: true })];
  const params = validateInspireJobParams({ ...BASE, '18_table_relationships': JSON.stringify(sent) });
  assert.deepEqual(JSON.parse(params['18_table_relationships']), [
    join('main.s.orders', 'customer_id', 'main.s.customers', 'customer_id'),
    join('main.s.job_log', 'order_id', 'main.s.orders', 'order_id', { removed: true }),
  ]);
});

test('REQ-584: the wizard launch text keeps the removed flag (must-fail before c38)', async () => {
  const { launchRelationshipsText } = await import('../../frontend/src/lib/tableRelationships.js');
  const out = JSON.parse(launchRelationshipsText([join('main.s.a', 'b_id', 'main.s.b', 'b_id', { removed: true }), join('main.s.a', 'c_id', 'main.s.c', 'c_id')], ['main.s.a', 'main.s.b', 'main.s.c']));
  assert.deepEqual(out, [join('main.s.a', 'b_id', 'main.s.b', 'b_id', { removed: true }), join('main.s.a', 'c_id', 'main.s.c', 'c_id')]);
});

test('must-keep (REQ-373): a join with no flag goes out as today, removed:false is not sent, a malformed entry is still refused', () => {
  const params = validateInspireJobParams({ ...BASE, '18_table_relationships': JSON.stringify([join('main.s.orders', 'customer_id', 'main.s.customers', 'customer_id', { removed: false })]) });
  assert.deepEqual(JSON.parse(params['18_table_relationships']), [join('main.s.orders', 'customer_id', 'main.s.customers', 'customer_id')]);
  assert.throws(() => validateInspireJobParams({ ...BASE, '18_table_relationships': JSON.stringify([{ from: { table: 'orders' }, removed: true }]) }), /Relationship 1 needs/);
});
