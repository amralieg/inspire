const test = require('node:test');
const assert = require('node:assert/strict');
const kinds = require('../../agent/agent/app_shell/kinds.json');
const { analysisMinimumRows, groupCountsStatement, readinessStatement } = require('../lib/inspireImplement');
const { tooFewRowsText, columnsReadOf, filterTablesOutside, withoutTableFilters, groupPartColumns, countedFor } = require('../../frontend/src/lib/implementWizard.js');
const { withScopedRows, scopedGroupRows } = require('../../frontend/src/lib/runScope.js');

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
  assert.equal(withScopedRows(profile, NaN).records, null, 'a count that was not taken shows no number');
  assert.equal(withScopedRows(profile, NaN).first_run.all, null);
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

test('each execution family carries the minimum rows the analysis needs, set in kinds.json', () => {
  assert.equal(analysisMinimumRows('Classification'), 200);
  assert.equal(analysisMinimumRows('Forecasting'), 60);
  assert.equal(analysisMinimumRows('Anomaly Detection'), 100);
  assert.equal(analysisMinimumRows('Clustering'), 50);
  assert.equal(analysisMinimumRows('Entity Matching'), 2);
  assert.equal(analysisMinimumRows('Trend Analysis'), 1, 'descriptive analyses need one row');
});

test('a scope under the forecast minimum warns, one over it does not', () => {
  assert.match(tooFewRowsText({ row_count: 30, minimum_rows: analysisMinimumRows('Forecasting') }), /Only 30 rows/);
  assert.equal(tooFewRowsText({ row_count: 61, minimum_rows: analysisMinimumRows('Forecasting') }), '');
});

test('group counts for a narrowed scope come from the scoped count per group, and a group missing from the result is unknown', () => {
  const profile = { records: 3333, suggested_groups: [
    { value: 'Starbucks', records: 900, parts: [{ column: 'brand', value: 'Starbucks' }] },
    { value: 'Costa', records: 400, parts: [{ column: 'brand', value: 'Costa' }] },
  ] };
  const scoped = withScopedRows(profile, 2, [{ brand: 'Starbucks', records: '2' }]);
  assert.deepEqual(scoped.suggested_groups.map((g) => g.records), [2, null]);
  assert.deepEqual(groupPartColumns(profile), ['brand']);
});

test('a group-count query groups by the named columns under the same scope as the readiness count', () => {
  const statement = groupCountsStatement('main.s.orders', ['brand'], { filters: [{ table: 'main.s.orders', column: 'brand', op: 'in', values: ['Starbucks'] }] });
  assert.match(statement.sql, /GROUP BY `brand`/);
  assert.match(statement.sql, /COUNT\(\*\) AS records FROM `main`\.`s`\.`orders` WHERE /);
  assert.equal(groupCountsStatement('main.s.orders', [], {}), null, 'no group columns, no query');
});

test('filters left on a table that is no longer a source are listed, and Remove drops only that table', () => {
  const spec = { data: { filters: [
    { table: 'main.s.orders', column: 'status', op: 'in', values: ['gold'] },
    { table: 'main.s.gone', column: 'region', op: 'in', values: ['EU'] },
  ] } };
  assert.deepEqual(filterTablesOutside(spec.data.filters, ['main.s.orders']), ['main.s.gone']);
  assert.deepEqual(filterTablesOutside(spec.data.filters, ['MAIN.S.ORDERS', 'main.s.gone']), []);
  const after = withoutTableFilters(spec, 'main.s.gone');
  assert.deepEqual(after.data.filters.map((f) => f.table), ['main.s.orders']);
  assert.equal(spec.data.filters.length, 2, 'the original spec is not changed');
});

test('a technique named in technique_min_rows keeps its own minimum, and any other technique falls back to its family minimum', () => {
  assert.equal(analysisMinimumRows('Regression Analysis'), 100, 'regression sits in family F (1) but keeps its own 100');
  assert.equal(analysisMinimumRows('Trend Analysis'), kinds.readiness_thresholds[kinds.execution_family['Trend Analysis']].min_rows);
  assert.equal(analysisMinimumRows('Entity Matching'), 2);
});

test('a group-count query carries every column the wizard sends, up to eight, and reads one row past its limit to tell truncation', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];
  const statement = groupCountsStatement('main.s.orders', six, {});
  for (const column of six) assert.match(statement.sql, new RegExp(`GROUP BY .*\`${column}\``), `${column} is grouped`);
  assert.match(statement.sql, /LIMIT 5001$/);
  assert.equal(groupCountsStatement('main.s.orders', Array.from({ length: 9 }, (_, i) => `c${i}`), {}), null, 'nine columns are refused, not cut');
});

test('a group sums every row of the scoped result that matches its values, and a group with no matching row is unknown, never zero', () => {
  const profile = { suggested_groups: [
    { value: 'Starbucks', parts: [{ column: 'brand', value: 'Starbucks' }] },
    { value: 'Costa', parts: [{ column: 'brand', value: 'Costa' }] },
    { value: 'Nero', parts: [{ column: 'brand', value: 'Nero' }] },
  ] };
  const rows = [{ brand: 'Starbucks', size: 'S', records: 2 }, { brand: 'Starbucks', size: 'L', records: 3 }];
  assert.deepEqual(withScopedRows(profile, 5, rows).suggested_groups.map((g) => g.records), [5, null, null]);
});

test('a truncated group-count answer makes every group unknown', () => {
  assert.equal(scopedGroupRows({ truncated: true, groups: [{ brand: 'x', records: 1 }] }), null);
  assert.deepEqual(scopedGroupRows({ truncated: false, groups: [{ brand: 'x', records: 1 }] }), [{ brand: 'x', records: 1 }]);
  assert.equal(scopedGroupRows(null), null);
});

test('a Leave out filter keeps the rows whose value is NULL, because NULL is not in the list', () => {
  const statement = readinessStatement('main.s.orders', { filters: [{ table: 'main.s.orders', column: 'status', op: 'not in', values: ['gold'] }] });
  assert.match(statement.sql, /\(CAST\(`status` AS STRING\) NOT IN \(:f0_0\) OR `status` IS NULL\)/);
  const keep = readinessStatement('main.s.orders', { filters: [{ table: 'main.s.orders', column: 'status', op: 'in', values: ['gold'] }] });
  assert.doesNotMatch(keep.sql, /IS NULL/, 'a Keep only filter still drops NULL rows');
});

test('a too-few-rows sentence only quotes the count of the scope on screen, never another scope', () => {
  const scopeA = { table: 'main.s.orders', columns: [], filters: [{ table: 'main.s.orders', column: 'status', op: 'in', values: ['gold'] }], window: {} };
  const scopeB = { ...scopeA, filters: [{ table: 'main.s.orders', column: 'status', op: 'in', values: ['silver'] }] };
  const readiness = { scope: scopeA, row_count: 12, minimum_rows: 30 };
  assert.equal(tooFewRowsText(countedFor(readiness, scopeB)), '', 'the count of gold is not quoted for silver');
  assert.match(tooFewRowsText(countedFor(readiness, scopeA)), /Only 12 rows/);
});
