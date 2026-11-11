import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnValuesIn, groupAliases, setColumnValueIn } from '../src/filters.js';

const META = {
  filters: [{ id: 'region', label: 'Region', type: 'multi_select' }],
  columns: {
    list: [{ column: 'region', label: 'Region', type: 'multi_select' }],
    tables: { sales: [{ column: 'region', label: 'Region', type: 'multi_select' }], stock: [{ column: 'site', label: 'Site', type: 'multi_select' }] },
  },
};

test('a table column filter with the same label as a top filter shares that one store, on every table', () => {
  const aliases = groupAliases(META);
  assert.equal(aliases['|region'], 'region', 'the Work list column is linked');
  assert.equal(aliases['sales|region'], 'region', 'a table column is linked too');
  assert.equal(aliases['stock|site'], undefined, 'a column with another label keeps its own store');
  const state = setColumnValueIn({ sel: {} }, 'sales', 'region', ['North'], aliases);
  assert.deepEqual(state.sel.region, ['North'], 'the top bar sees the table filter');
  assert.deepEqual(columnValuesIn(state, 'sales', aliases).region, ['North']);
  assert.deepEqual(columnValuesIn(state, '', aliases).region, ['North'], 'the Work list agrees with the table');
});
