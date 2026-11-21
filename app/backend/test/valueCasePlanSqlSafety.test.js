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
  assert.doesNotMatch(made.sql, /WHERE/);
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
