// REQ-436 review: the stale count and grouped reads take a plan that came back from the browser (saved answers), so every piece of it
// that reaches SQL text is checked again there: the filter operator, the column names and the metric aliases.
const test = require('node:test');
const assert = require('node:assert/strict');
const GP = require('../lib/groupingProfile');
const VCP = require('../lib/valueCasePlan');

const plan = (over = {}) => ({ table: 'c.s.t', date_column: 'event_date', case_filter: null, grouping: 'region', metrics: [], drivers: [], ...over });

test('a forged filter operator never reaches the stale count SQL', () => {
  const made = VCP.currentCountSql(GP, {}, plan({ case_filter: { column: 'kind', op: '= 1 OR 1=1 --', value: 'x' } }));
  assert.doesNotMatch(made.sql, /OR 1=1/);
  assert.doesNotMatch(made.sql, /`kind`/); // only the dated-rows condition remains (REQ-448)
});

test('a forged filter operator never reaches the grouped SQL', () => {
  const made = VCP.groupedSql(GP, {}, plan({ case_filter: { column: 'kind', op: '; DROP TABLE x', value: 'x' } }), 'c.s.t', 'event_date');
  assert.doesNotMatch(made.sql, /DROP/);
});

test('a column name with a backtick is refused, not stripped into another name', () => {
  assert.throws(() => VCP.currentCountSql(GP, {}, plan({ date_column: 'a`b' })));
});

test('a metric id that is not an identifier never reaches the SQL as an alias', () => {
  const made = VCP.groupedSql(GP, {}, plan({ metrics: [{ id: 'x, 1 AS y', label: 'x', column: 'amount', agg: 'avg' }] }), 'c.s.t', 'event_date');
  assert.doesNotMatch(made.sql, /1 AS y/);
});

test('a valid filter is kept with its value bound', () => {
  const made = VCP.currentCountSql(GP, {}, plan({ case_filter: { column: 'kind', op: '=', value: 'fraud' } }));
  assert.match(made.sql, /WHERE `kind` = :/);
  assert.doesNotMatch(made.sql, /fraud/);
});

test('a sum-per-year metric shows the sum over the included groups, an average metric the records-weighted average', () => {
  const VDC = require('../lib/valueDriversCalc');
  const groups = [{ g: 'a', records_per_year: 1000, metrics: { spend: 100, amt: 10 } }, { g: 'b', records_per_year: 3000, metrics: { spend: 300, amt: 20 } }];
  assert.equal(VDC.dataFigure({ id: 'base_revenue_per_year', metric: 'spend' }, groups, 'sum_per_year'), 400);
  assert.equal(VDC.dataFigure({ id: 'cost_per_incident', metric: 'amt' }, groups, 'avg'), 17.5);
});
