// REQ-507 L4 (pure): frontend/src/lib/valueScope.js, the text and choices behind the new Data and Filter pages of the value wizard. Records
// found come first (rows, dates, date column), then the choice "All data / Last 12 months / Write a filter", the 5 example phrases, and every
// predicate as a removable chip. All text is built from the structure the server returns, never from model text.
import test from 'node:test';
import assert from 'node:assert/strict';

const VS = await import('../src/lib/valueScope.js').catch(() => ({}));

const FACTS = { table: 'main.s.orders', rows: 3412880, dated_rows: 3400840, first: '2019-01-01', last: '2026-09-30', date_column: 'transaction_time',
  date_candidates: [{ column: 'transaction_time', first: '2019-01-01', last: '2026-09-30' }, { column: 'shipped_at', first: '2019-01-03', last: '2026-10-02' }] };

test('L4: routes and the 5 example phrases from the approved design', () => {
  assert.equal(VS.SCOPE_ROUTE, '/api/inspire/value/scope');
  assert.equal(VS.FILTER_ROUTE, '/api/inspire/value/filter');
  assert.deepEqual(VS.FILTER_EXAMPLES, [
    'Only include transactions from the last 1 year',
    'Exclude cancelled and test records',
    'Only the top 3 regions by volume',
    'Amount above 100 and status is completed',
    'Only customers who joined since 2024',
  ]);
});

test('L4: the facts line names the records found, the date range and the date column, with no money', () => {
  assert.equal(VS.factsLine(FACTS, 'transaction'), '3,412,880 transactions, 1 Jan 2019 to 30 Sep 2026, dated by transaction_time');
  const undated = VS.factsLine({ table: 'main.s.orders', rows: 500, dated_rows: 0, first: null, last: null, date_column: null, date_candidates: [] }, 'record');
  assert.match(undated, /^500 records/);
  assert.match(undated, /no date column/i);
  assert.doesNotMatch(undated, /\$|USD/);
});

test('L4: three choices; Last 12 months is recommended when the data spans over 15 months, and ends on the last day in the data', () => {
  const choices = VS.scopeChoices(FACTS);
  assert.deepEqual(choices.map((c) => c.id), ['all', 'last_12', 'filter']);
  const last12 = choices.find((c) => c.id === 'last_12');
  assert.equal(last12.recommended, true);
  assert.equal(last12.start, '2025-10-01');
  assert.equal(last12.end, '2026-09-30');
  assert.equal(choices.filter((c) => c.recommended).length, 1);
  const short = VS.scopeChoices({ ...FACTS, first: '2025-12-01' });
  assert.equal(short.find((c) => c.id === 'last_12').recommended, false);
  assert.equal(short.find((c) => c.id === 'all').recommended, true);
  const undated = VS.scopeChoices({ ...FACTS, first: null, last: null, date_column: null, date_candidates: [] });
  assert.deepEqual(undated.map((c) => c.id), ['all', 'filter'], 'no window without a date column');
});

test('L4: All data is a scope with no filter; Last 12 months is a structured window posted to the filter route (no phrase, no model)', () => {
  assert.deepEqual(VS.scopeOfChoice('all', FACTS), { phrase: 'All data', filters: [], window: null, rows_before: 3412880, rows_after: 3412880, first: '2019-01-01', last: '2026-09-30' });
  assert.deepEqual(VS.filterBodyOfChoice('last_12', FACTS), { date_column: 'transaction_time', filters: [], window: { column: 'transaction_time', last_n: 12, unit: 'month' } });
});

test('L4: each predicate reads as plain English and can be removed as a chip; removing one asks for a recount', () => {
  assert.equal(VS.predicateText({ column: 'order_type', op: '!=', values: ['test'] }), 'order_type is not test');
  assert.equal(VS.predicateText({ column: 'status', op: 'in', values: ['paid', 'shipped'] }), 'status is paid or shipped');
  assert.equal(VS.predicateText({ column: 'status', op: 'not in', values: ['cancelled', 'test'] }), 'status is not cancelled or test');
  assert.equal(VS.predicateText({ column: 'amount', op: '>', values: ['100'] }), 'amount is above 100');
  assert.equal(VS.predicateText({ column: 'amount', op: 'between', values: ['10', '20'] }), 'amount is between 10 and 20');
  assert.equal(VS.predicateText({ column: 'shipped_at', op: 'is null', values: [] }), 'shipped_at is empty');
  assert.equal(VS.predicateText({ column: 'shipped_at', op: 'is not null', values: [] }), 'shipped_at is not empty');
  const scope = { phrase: 'x', filters: [{ column: 'order_type', op: '!=', values: ['test'] }, { column: 'status', op: '=', values: ['paid'] }],
    window: { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30' }, rows_before: 100, rows_after: 40, first: '2025-10-01', last: '2026-09-30' };
  const left = VS.withoutPredicate(scope, 0);
  assert.deepEqual(left.filters, [{ column: 'status', op: '=', values: ['paid'] }]);
  assert.deepEqual(left.window, scope.window);
  assert.equal(left.rows_after, null, 'the count is stale until the server counts again');
  assert.equal(scope.filters.length, 2, 'the old scope is kept for undo');
});

test('L4: an unmatched phrase names the close columns, and a rank filter says why it is refused', () => {
  assert.equal(VS.unmatchedLine({ phrase: 'Only the North region', column: 'region', close: ['region_name', 'sales_area'] }),
    "I found no column for 'region'. Columns that look close: region_name, sales_area.");
  assert.match(VS.unmatchedLine({ phrase: 'top 3 regions', close: [] }), /rank filters are not supported; name the regions/i);
});
