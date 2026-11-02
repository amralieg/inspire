import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiColumns, apiTables, clearColumnValues, columnFilterOn, columnFilterText, columnFiltersOn, columnValues, initialFilterState, rangeProblem, rangeValue,
  setColumnValue, setSelection,
} from '../src/filters.js';
import { addView, buildHash, compactState, describeFilters, parseHash, readLink, readSaved, readViews, restoreFilters, sameView, writeViews } from '../src/links.js';

const META = [
  { id: 'run_date', type: 'date_range', label: 'Run date', default: 'all', low: '2024-01-05', high: '2026-10-15',
    presets: [{ id: 'all', label: 'All time', from: '2024-01-05', to: '2026-10-15' }] },
  { id: 'channel', type: 'multi_select', label: 'Channel', options: ['Store', 'Web'] },
];
const COLUMNS = {
  list: [
    { column: 'priority_tier', type: 'multi_select', label: 'Tier', options: ['Act now', 'Monitor', 'Review'], searchable: false },
    { column: 'value_at_stake', type: 'number_range', label: 'Loss at stake' },
  ],
  tables: { worst: [{ column: 'category', type: 'multi_select', label: 'Category', options: ['Books', 'Toys'] }, { column: 'event_date', type: 'date_range', label: 'Last return' }] },
};
const VIEWS = ['overview', 'runs', 'alerts'];
const fresh = () => initialFilterState(META);

test('a column value sets, narrows and clears one table without touching the page filters or another table', () => {
  let state = setSelection(fresh(), 'channel', ['Web']);
  state = setColumnValue(state, null, 'priority_tier', ['Act now']);
  state = setColumnValue(state, 'worst', 'category', ['Books']);
  assert.deepEqual(state.sel, { channel: ['Web'] });
  assert.deepEqual(columnValues(state, null), { priority_tier: ['Act now'] });
  assert.deepEqual(columnValues(state, 'worst'), { category: ['Books'] });
  assert.deepEqual(apiTables(state), { worst: { category: ['Books'] } });
  const cleared = clearColumnValues(state, null);
  assert.deepEqual(columnValues(cleared, null), {});
  assert.deepEqual(columnValues(cleared, 'worst'), { category: ['Books'] }, 'clearing the list leaves the other table');
  assert.deepEqual(cleared.sel, { channel: ['Web'] });
  const emptied = setColumnValue(cleared, 'worst', 'category', []);
  assert.deepEqual(emptied.columns.tables, {}, 'a table with no value left drops out');
  assert.deepEqual(columnValues(fresh(), null), {});
  assert.deepEqual(columnValues(undefined, 'worst'), {});
});

test('only a value that narrows counts, is sent, and reads as a short phrase', () => {
  const values = { priority_tier: ['Act now', 'Review'], value_at_stake: { min: 100, max: null }, category: [], other: { min: null, max: null } };
  assert.equal(columnFiltersOn(values), 2);
  assert.deepEqual(apiColumns(values), { priority_tier: ['Act now', 'Review'], value_at_stake: { min: 100, max: null } });
  assert.equal(columnFilterOn(null), false);
  assert.equal(columnFilterOn({ from: '', to: '' }), false);
  const money = COLUMNS.list[1];
  assert.equal(columnFilterText(COLUMNS.list[0], ['Act now']), 'Act now');
  assert.equal(columnFilterText(COLUMNS.list[0], ['Act now', 'Review']), '2 selected');
  assert.equal(columnFilterText(money, { min: 1500, max: 25000 }), '1,500 to 25,000');
  assert.equal(columnFilterText(money, { min: 1500, max: null }), 'from 1,500');
  assert.equal(columnFilterText(money, { min: null, max: 0 }), 'up to 0');
  assert.equal(columnFilterText(money, null), 'All');
});

test('a range form refuses a From above its To and text in a number box, and an empty form sends nothing', () => {
  assert.equal(rangeProblem('number_range', '5000', '100'), 'The From value is above the To value');
  assert.equal(rangeProblem('number_range', 'abc', ''), 'Enter a number');
  assert.equal(rangeProblem('number_range', '100', '5000'), '');
  assert.equal(rangeProblem('number_range', '0', ''), '');
  assert.equal(rangeProblem('date_range', '2026-05-01', '2026-04-30'), 'The From value is above the To value');
  assert.equal(rangeProblem('date_range', '2026-04-01', '2026-04-30'), '');
  assert.deepEqual(rangeValue('number_range', ' 100 ', ''), { min: 100, max: null });
  assert.deepEqual(rangeValue('number_range', '0', '0'), { min: 0, max: 0 });
  assert.deepEqual(rangeValue('date_range', '', '2026-04-30'), { from: null, to: '2026-04-30' });
  assert.equal(rangeValue('number_range', '', '  '), null);
});

test('column filters ride in the link and a saved view next to the page filters, and come back the same', () => {
  let state = setSelection(fresh(), 'channel', ['Web']);
  state = setColumnValue(state, null, 'priority_tier', ['Act now']);
  state = setColumnValue(state, null, 'value_at_stake', { min: 100, max: null });
  state = setColumnValue(state, 'worst', 'event_date', { from: '2026-01-01', to: null });
  const compact = compactState(state, META, COLUMNS);
  assert.deepEqual(compact, { s: { channel: ['Web'] }, c: { l: { priority_tier: ['Act now'], value_at_stake: [100, null] }, t: { worst: { event_date: ['2026-01-01', null] } } } });
  const hash = buildHash('n09_u03', 'overview', state, META, null, COLUMNS);
  const back = readLink(parseHash(hash), META, VIEWS, COLUMNS);
  assert.equal(back.dropped, false);
  assert.deepEqual(columnValues(back.state, null), { priority_tier: ['Act now'], value_at_stake: { min: 100, max: null } });
  assert.deepEqual(columnValues(back.state, 'worst'), { event_date: { from: '2026-01-01', to: null } });
  assert.deepEqual(back.state.sel, { channel: ['Web'] });
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
  const { all } = addView({}, 'n09_u03', { name: 'Act now only', view: 'overview', filters: compact });
  assert.equal(writeViews(storage, all), true);
  const saved = readViews(storage).n09_u03[0];
  assert.equal(sameView(saved, { view: 'overview', filters: compactState(back.state, META, COLUMNS) }), true);
  const applied = readSaved(saved, META, VIEWS, COLUMNS);
  assert.equal(applied.dropped, false);
  assert.deepEqual(columnValues(applied.state, null), columnValues(state, null));
  assert.equal(describeFilters(state, META, COLUMNS), 'Run date: all time; Channel: Web; Tier: Act now; Loss at stake: from 100; Last return: from 2026-01-01');
});

test('a link whose column filter no longer applies is dropped with the notice and keeps what still applies', () => {
  const stale = {
    c: { l: { priority_tier: ['Act now', 'Gone'], value_at_stake: [500, 100], confidence_level: ['High'] }, t: { worst: { event_date: ['2026-13-01', null] }, nope: { a: ['x'] } } },
  };
  const out = restoreFilters(stale, META, COLUMNS);
  assert.equal(out.dropped, true);
  assert.deepEqual(columnValues(out.state, null), { priority_tier: ['Act now'] });
  assert.deepEqual(out.state.columns.tables, {});
  for (const bad of [{ c: 'x' }, { c: { l: [] } }, { c: { t: 'x' } }, { c: { z: {} } }, { c: { l: { value_at_stake: [null, null] } } },
    { c: { l: { value_at_stake: ['1', 2] } } }, { c: { l: { value_at_stake: [1] } } }]) {
    assert.equal(restoreFilters(bad, META, COLUMNS).dropped, true, JSON.stringify(bad));
  }
  const fine = restoreFilters({ c: { l: { value_at_stake: [null, 0] } } }, META, COLUMNS);
  assert.equal(fine.dropped, false);
  assert.deepEqual(columnValues(fine.state, null), { value_at_stake: { min: null, max: 0 } });
});

test('a page with no column filters keeps the link and the view exactly as before', () => {
  const state = setSelection(fresh(), 'channel', ['Web']);
  assert.deepEqual(compactState(state, META), { s: { channel: ['Web'] } });
  assert.deepEqual(compactState(state, META, { list: [], tables: {} }), { s: { channel: ['Web'] } });
  assert.equal(buildHash('n01_u05', 'overview', state, META), buildHash('n01_u05', 'overview', state, META, null, { list: [], tables: {} }));
  const back = restoreFilters({ s: { channel: ['Web'] } }, META);
  assert.deepEqual(back, { state, dropped: false });
  assert.equal('columns' in back.state, false);
  assert.equal(describeFilters(state, META), 'Run date: all time; Channel: Web');
  assert.equal(describeFilters(state, META, { list: [], tables: {} }), describeFilters(state, META));
  assert.equal(restoreFilters({ c: { l: { priority_tier: ['Act now'] } } }, META).dropped, true, 'a column value on a page that has none is stale');
});
