const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const SIBLING = { id: 'N01-U02', tables_involved: 'main.s.orders, main.s.customers', primary_table: 'main.s.orders' };
const spec = (tables) => ({ use_case_id: 'N01-U02', data: { tables, removed_tables: [] }, config: { result_table: 'main.inspire.n01_u02_results' } });

test('a sibling spec with no table swaps reads the sibling use case tables, as the Build next submit sends it', () => {
  assert.deepEqual(I.sourceTables(spec({}), I.useCaseTables(SIBLING)), ['main.s.orders', 'main.s.customers']);
});

test('a swap is keyed by the original table, so the App swap does not reach a sibling that lacks that table', () => {
  assert.deepEqual(I.sourceTables(spec({ 'main.s.orders': 'main.s.orders_v2' }), I.useCaseTables(SIBLING)), ['main.s.orders_v2', 'main.s.customers']);
  const other = { id: 'N03-U01', tables_involved: 'main.s.stock', primary_table: 'main.s.stock' };
  assert.deepEqual(I.sourceTables(spec({ 'main.s.orders': 'main.s.orders_v2' }), I.useCaseTables(other)), ['main.s.stock']);
});
