import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupedByText, groupsOf } from '../src/filters.js';

test('the grouping chip names the grouping columns by their Work list labels, and says nothing with no grouping', () => {
  assert.equal(groupedByText({ mode: 'columns', group_by: [{ column: 'channel', label: 'Channel' }, { column: 'return_reason', label: 'Return reason' }] }),
    'Grouped by Channel, Return reason');
  assert.equal(groupedByText({ mode: 'all', group_by: [] }), '');
  assert.equal(groupedByText({}), '');
  assert.equal(groupedByText(undefined), '');
});

test('a grouping column stays a top filter even with many choices, and any other many-choice column still goes behind More filters', () => {
  const options = Array.from({ length: 12 }, (_, i) => `v${i}`);
  const meta = { filters: [], columns: { list: [
    { column: 'region', type: 'multi_select', label: 'Region', options, grouping: true },
    { column: 'store', type: 'multi_select', label: 'Store', options },
  ], tables: {} } };
  const byKey = Object.fromEntries(groupsOf(meta).map((g) => [g.id, g]));
  assert.equal(byKey.region.high, false);
  assert.equal(byKey.store.high, true);
});
