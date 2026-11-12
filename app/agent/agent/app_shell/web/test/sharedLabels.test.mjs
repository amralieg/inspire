import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiTables, apiValues, clearColumnValuesIn, columnValuesIn, groupAliases, groupValues, groupsOf, setGroupValues, setColumnValueIn } from '../src/filters.js';

const PASSENGER = { column: 'passenger_profile', label: 'Passenger profile', type: 'multi_select', options: ['P1', 'P2'] };
const META = {
  filters: [],
  columns: {
    list: [{ ...PASSENGER }, { column: 'possible_duplicate', label: 'Possible duplicate', type: 'multi_select', options: ['Yes', 'No'] }],
    tables: { groups: [{ ...PASSENGER }, { column: 'identity_group', label: 'Identity group', type: 'multi_select', options: ['G1'] }] },
  },
};
const EMPTY = { range: {}, sel: {}, columns: { list: {}, tables: {} } };

test('a label that two column filters share is one filter in the bar, not two', () => {
  const labels = groupsOf(META).map((g) => g.label);
  assert.equal(labels.filter((l) => l === 'Passenger profile').length, 1);
  assert.equal(labels.filter((l) => l === 'Possible duplicate').length, 1);
  assert.equal(labels.filter((l) => l === 'Identity group').length, 1);
});

test('the one shared filter writes one state that both the list column and the table column read', () => {
  const aliases = groupAliases(META);
  const shared = groupsOf(META).find((g) => g.label === 'Passenger profile');
  const next = setGroupValues(EMPTY, shared, ['P1']);
  assert.deepEqual(groupValues(next, shared), ['P1']);
  assert.deepEqual(columnValuesIn(next, null, aliases).passenger_profile, ['P1'], 'the list column reads the bar value');
  assert.deepEqual(columnValuesIn(next, 'groups', aliases).passenger_profile, ['P1'], 'the table column reads the same value');
});

test('a table column whose label is shared writes through the same state the bar shows', () => {
  const aliases = groupAliases(META);
  const next = setColumnValueIn(EMPTY, 'groups', 'passenger_profile', ['P2'], aliases);
  assert.deepEqual(columnValuesIn(next, null, aliases).passenger_profile, ['P2'], 'the bar sees the table choice');
});

test('a label used by one column stays on its own column state, unchanged', () => {
  const aliases = groupAliases(META);
  assert.equal(aliases['|possible_duplicate'], undefined);
  const solo = groupsOf(META).find((g) => g.label === 'Possible duplicate');
  assert.equal(solo.page, false);
});

test('the request carries a shared value as the column filter of every column it stands for, never as an unknown filter id', () => {
  const shared = groupsOf(META).find((g) => g.label === 'Passenger profile');
  const bar = setGroupValues(EMPTY, shared, ['P1']);
  assert.deepEqual(apiTables(bar), { groups: { passenger_profile: ['P1'] } }, 'the table request names its own column');
  assert.deepEqual(Object.keys(apiValues(bar)), [], 'no label: id goes to the server as a filter');
  const aliases = groupAliases(META);
  const table = setColumnValueIn(EMPTY, 'groups', 'passenger_profile', ['P2'], aliases);
  assert.deepEqual(apiTables(table), { groups: { passenger_profile: ['P2'] } });
  const cleared = clearColumnValuesIn(bar, null, aliases);
  assert.deepEqual(apiTables(cleared), {}, 'clearing the bar clears the table column too');
  assert.deepEqual(columnValuesIn(cleared, 'groups', aliases).passenger_profile, []);
});
