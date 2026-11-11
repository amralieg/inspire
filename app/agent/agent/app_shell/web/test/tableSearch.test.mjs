import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchRows } from '../src/grid.js';

const COLUMNS = [{ key: 'store', label: 'Store' }, { key: 'region', label: 'Region' }, { key: 'sales', label: 'Sales', num: true }];
const ROWS = [
  { store: 'Harbor Store', region: 'North', sales: 1200 },
  { store: 'Sunset Shop', region: 'South', sales: 980 },
  { store: 'Golden Gate Bakery', region: 'North', sales: 450 },
];

test('the table search keeps the rows whose visible cells contain the text, in any column, ignoring case', () => {
  assert.deepEqual(searchRows(ROWS, COLUMNS, 'harbor').map((r) => r.store), ['Harbor Store']);
  assert.deepEqual(searchRows(ROWS, COLUMNS, 'NORTH').map((r) => r.store), ['Harbor Store', 'Golden Gate Bakery']);
  assert.deepEqual(searchRows(ROWS, COLUMNS, '980').map((r) => r.store), ['Sunset Shop'], 'a number cell is searched too');
});

test('an empty or blank search keeps every row, and a search that matches nothing keeps none', () => {
  assert.equal(searchRows(ROWS, COLUMNS, ''), ROWS);
  assert.equal(searchRows(ROWS, COLUMNS, '   '), ROWS);
  assert.deepEqual(searchRows(ROWS, COLUMNS, 'zzz'), []);
});
