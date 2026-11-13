// REQ-171: the App reads a use case's Data Filters from the session's Table Scope, and formats them the way the notebook writes the
// Excel, CSV, PDF and markdown. The shared fixture app/agent/tests/fixtures/data_filter_cases.json holds the expected output; the
// notebook's own test checks the same file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useCaseDataFilters, dataFiltersOf, scopesOfSessions, DATA_FILTER_VALUE_LIMIT } = require('../lib/dataFilters');
const { parseTableScopeText } = require('../lib/inspireJobParams');

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'agent', 'tests', 'fixtures', 'data_filter_cases.json'), 'utf8'));
const scopes = parseTableScopeText(JSON.stringify(FIXTURE.scopes)).scopes;

test('every case of the shared fixture gives the same columns and line the notebook writes', () => {
  for (const c of FIXTURE.cases) {
    const got = dataFiltersOf({ primary_table: c.uc.primary_table, tables_involved: c.uc.tables_involved }, scopes);
    assert.deepEqual(got, c.columns, c.name);
    assert.equal(got.map((f) => `${f.column}: ${f.text}`).join('; '), c.line, c.name);
  }
});

test('a use case over no filtered table has no Data Filters, and a range filter is not one', () => {
  assert.deepEqual(dataFiltersOf({ primary_table: 'main.s.none', tables_involved: 'main.s.none' }, scopes), []);
  assert.deepEqual(useCaseDataFilters({ primary_table: 'main.s.orders', tables_involved: 'main.s.orders' }, scopes).map((f) => f.column), ['product', 'region', 'channel']);
});

test('the reader matches the tables of a use case without regard to case or backticks', () => {
  assert.deepEqual(dataFiltersOf({ primary_table: '`MAIN`.`S`.`SALES`', tables_involved: '' }, scopes), [{ column: 'product', text: 'Tokyo Tidbits' }]);
});

test('a long value list keeps its first ten values and counts the rest, as the notebook does', () => {
  assert.equal(DATA_FILTER_VALUE_LIMIT, 10);
  const big = FIXTURE.cases.find((c) => c.name === 'a long value list');
  assert.equal(dataFiltersOf({ primary_table: 'main.s.big', tables_involved: '' }, scopes)[0].text, big.columns[0].text);
});

test('each session of the use-case list reads its own Table Scope, and a session with no scope has none', () => {
  const texts = [['42', JSON.stringify({ 'main.s.sales': { columns: ['product'], rows: [{ column: 'product', op: '=', values: ['A'] }] } })], ['43', '']];
  const bySession = scopesOfSessions(texts);
  assert.deepEqual(dataFiltersOf({ primary_table: 'main.s.sales', tables_involved: '' }, bySession.get('42')), [{ column: 'product', text: 'A' }]);
  assert.deepEqual(dataFiltersOf({ primary_table: 'main.s.sales', tables_involved: '' }, bySession.get('43')), []);
});

test('the use-case list route attaches the Data Filters of each session and says when a session cannot be read', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /row\.data_filters = scopes === undefined \? null : dataFiltersOf\(row, scopes\)/);
  assert.match(server, /could not be read, so their use cases say so/);
});
