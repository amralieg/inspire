const test = require('node:test');
const assert = require('node:assert/strict');
const kinds = require('../../agent/agent/app_shell/kinds.json');
const { analysisMinimumRows } = require('../lib/inspireImplement');
const { tooFewRowsText, columnsReadOf } = require('../../frontend/src/lib/implementWizard.js');
const { withScopedRows } = require('../../frontend/src/lib/runScope.js');

test('the analysis minimum for a use case comes from kinds.json readiness_thresholds through its execution family', () => {
  const technique = 'Classification';
  const family = kinds.execution_family[technique];
  assert.equal(family, 'A');
  assert.equal(analysisMinimumRows(technique), kinds.readiness_thresholds[family].min_rows);
  assert.equal(analysisMinimumRows('  classification '), kinds.readiness_thresholds[family].min_rows, 'case and spacing do not matter');
});

test('a technique kinds.json does not know has no analysis minimum, so no warning is raised', () => {
  assert.equal(analysisMinimumRows('Made Up Technique'), null);
  assert.equal(analysisMinimumRows(''), null);
  assert.equal(analysisMinimumRows(undefined), null);
});

test('every technique maps to a family that carries a numeric min_rows in kinds.json', () => {
  for (const [technique, family] of Object.entries(kinds.execution_family)) {
    assert.ok(kinds.readiness_thresholds[family], `${technique} names family ${family}, which has no thresholds`);
    assert.ok(Number.isFinite(kinds.readiness_thresholds[family].min_rows), `${family} has no min_rows`);
  }
});

test('a scope with fewer rows than the analysis minimum gets one plain sentence that never blocks', () => {
  assert.equal(tooFewRowsText({ row_count: 12, minimum_rows: 30 }),
    'Only 12 rows are in this scope, fewer than the 30 this use case needs; you can still go on.');
  assert.equal(tooFewRowsText({ row_count: 30, minimum_rows: 30 }), '', 'exactly the minimum is enough');
  assert.equal(tooFewRowsText({ row_count: 4000, minimum_rows: 30 }), '');
  assert.equal(tooFewRowsText({ row_count: 0, minimum_rows: 30 }), '', 'an empty scope has its own warning');
  assert.equal(tooFewRowsText({ row_count: 5, minimum_rows: null }), '', 'no minimum, no warning');
  assert.equal(tooFewRowsText({ skipped: true, row_count: 5, minimum_rows: 30 }), '', 'a count that was not taken is not judged');
});

test('a narrowed scope sizes the First run from its own count and drops whole-table counts that no longer match', () => {
  const profile = {
    records: 3333,
    recent: { days: 30, records: 900 },
    first_run: { all: 3333, recent: 900, records: 1000 },
    suggested_groups: [{ value: 'Starbucks', records: 500, kind: 'biggest', parts: [{ column: 'brand', value: 'Starbucks' }] }],
  };
  const scoped = withScopedRows(profile, 120);
  assert.equal(scoped.records, 120);
  assert.equal(scoped.first_run.all, 120);
  assert.equal(scoped.first_run.recent, null);
  assert.equal('recent' in scoped, false);
  assert.equal(scoped.suggested_groups[0].records, null);
  assert.equal(scoped.suggested_groups[0].value, 'Starbucks');
  assert.equal(profile.records, 3333, 'the whole-table profile is not changed');
  assert.equal(withScopedRows(null, 120), null);
  assert.equal(withScopedRows(profile, NaN), profile);
});

test('the columns Inspire reads for one table come from the column roles that point into it', () => {
  const spec = {
    data: {
      column_roles: { entity_id: 'main.s.orders.order_id', event_date: 'main.s.orders.order_date', measure: 'main.s.returns.amount' },
    },
  };
  assert.deepEqual(columnsReadOf(spec, 'main.s.orders'), ['order_id', 'order_date']);
  assert.deepEqual(columnsReadOf(spec, 'MAIN.S.RETURNS'), ['amount'], 'table names match without case');
  assert.deepEqual(columnsReadOf(spec, 'main.s.other'), []);
});
