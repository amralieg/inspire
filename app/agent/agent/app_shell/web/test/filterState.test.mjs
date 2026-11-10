import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnValuesIn, groupAliases, groupValues, groupsOf, initialFilterState, setColumnValueIn, setGroupValues } from '../src/filters.js';

const CATS = ['Books', 'Music', 'Home'];
const META = {
  filters: [{ id: 'category', type: 'multi_select', label: 'Category', options: CATS }, { id: 'region', type: 'multi_select', label: 'Region', options: ['North'] }],
  columns: { list: [{ column: 'category', type: 'multi_select', label: 'Category', options: CATS }], tables: { t: [{ column: 'urgency', type: 'multi_select', label: 'Urgency', options: ['Act now'] }] } },
};

test('a page filter and a Work column with the same label are one group, and the alias maps the column to the page filter', () => {
  assert.deepEqual(groupAliases(META), { '|category': 'category' });
  assert.equal(groupsOf(META).filter((g) => g.label === 'Category').length, 1, 'the top bar shows the group once');
});

test('filtering the top bar narrows the Work column, and filtering the Work column narrows the top bar', () => {
  const aliases = groupAliases(META);
  const start = initialFilterState(META.filters);
  const top = groupsOf(META).find((g) => g.label === 'Category');
  const fromTop = setGroupValues(start, top, ['Books']);
  assert.deepEqual(columnValuesIn(fromTop, null, aliases).category, ['Books'], 'Work reads the top bar selection');
  assert.deepEqual(fromTop.sel.category, ['Books']);
  const fromWork = setColumnValueIn(fromTop, null, 'category', ['Music', 'Home'], aliases);
  assert.deepEqual(groupValues(fromWork, top), ['Music', 'Home'], 'the top bar reads the Work selection');
  assert.deepEqual(columnValuesIn(fromWork, null, aliases).category, ['Music', 'Home']);
  const cleared = setColumnValueIn(fromWork, null, 'category', [], aliases);
  assert.deepEqual(groupValues(cleared, top), [], 'clearing in Work clears the top bar');
});

test('a Work column without a same-label page filter keeps its own selection', () => {
  const aliases = groupAliases(META);
  const state = setColumnValueIn(initialFilterState(META.filters), 't', 'urgency', ['Act now'], aliases);
  assert.deepEqual(state.columns.tables.t.urgency, ['Act now']);
  assert.equal(state.sel.urgency, undefined);
  assert.deepEqual(columnValuesIn(state, 't', aliases).urgency, ['Act now']);
});
