// REQ-507 L1 (pure): backend/lib/valueScope.js. A plain-English filter is turned by the model into STRUCTURE (column, op, values) and a
// relative window; this module validates that structure against the table's columns and compiles it with bound parameters through the
// existing filterClause/scopeWhere. The model never writes SQL text: a reply carrying SQL text, a DDL/DML keyword or an unknown key is
// rejected; an unknown column is reported as unmatched with close column names. The echo is built from the structure, never the model text.
const test = require('node:test');
const assert = require('node:assert/strict');
const GP = require('../lib/groupingProfile');

const VS = (() => {
  try {
    return require('../lib/valueScope');
  } catch {
    return {};
  }
})();

const TABLE = 'main.s.orders';
const COLUMNS = [
  { column_name: 'order_id', data_type: 'STRING' }, { column_name: 'region_name', data_type: 'STRING' }, { column_name: 'status', data_type: 'STRING' },
  { column_name: 'order_type', data_type: 'STRING' }, { column_name: 'amount', data_type: 'DOUBLE' },
  { column_name: 'transaction_time', data_type: 'TIMESTAMP' }, { column_name: 'shipped_at', data_type: 'DATE' },
];
const reply = (obj) => ({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] });
const allText = (made) => `${made.sql} ${JSON.stringify(made.parameters || [])}`;

test('L1: valueScope exports the pure contract', () => {
  for (const name of ['SCOPE_OPS', 'filterMessages', 'filterFrom', 'checkFilters', 'resolveWindow', 'factsSql', 'factsFrom', 'scopeCountSql', 'echoOf']) {
    assert.ok(VS[name] !== undefined, `valueScope.${name} is exported`);
  }
  assert.deepEqual([...VS.SCOPE_OPS].sort(), ['!=', '<', '<=', '=', '>', '>=', 'between', 'in', 'is not null', 'is null', 'not in'].sort());
});

test('L1: the filter prompt names every column with its type and asks for JSON structure only, never SQL', () => {
  const messages = VS.filterMessages({ useCase: { use_case: 'Stop fraud' }, table: TABLE, columns: COLUMNS, phrase: 'only the last 1 year' });
  const all = messages.map((m) => m.content).join('\n');
  for (const c of COLUMNS) assert.ok(all.includes(c.column_name), `prompt lists ${c.column_name}`);
  assert.match(all, /"filters"/);
  assert.match(all, /"window"/);
  assert.match(all, /"unmatched"/);
  assert.match(all, /only the last 1 year/);
  assert.match(all, /never (write|return) SQL/i);
});

test('L1: a good reply becomes validated structure: filters, a relative window and unmatched phrases', () => {
  const got = VS.filterFrom(reply({ filters: [{ column: 'order_type', op: '!=', values: ['test'] }, { column: 'amount', op: '>', values: [100] }],
    window: { column: 'transaction_time', last_n: 1, unit: 'year' }, echo: 'MODEL_ECHO_TEXT', unmatched: ['top 3 regions'] }), COLUMNS);
  assert.equal(got.ok, true, got.reason);
  assert.deepEqual(got.filters, [{ column: 'order_type', op: '!=', values: ['test'] }, { column: 'amount', op: '>', values: ['100'] }]);
  assert.deepEqual(got.window, { column: 'transaction_time', last_n: 1, unit: 'year' });
  assert.deepEqual(got.unmatched.map((u) => u.phrase), ['top 3 regions']);
});

test('L1 security: a reply that carries SQL text instead of structure is rejected', () => {
  for (const bad of [
    { sql: "SELECT * FROM main.s.orders WHERE status = 'x'" },
    { filters: [], where: "status = 'x' OR 1=1" },
    "status = 'paid'; DROP TABLE main.s.orders",
    { filters: [{ column: 'status', op: '= 1 OR 1=1 --', values: ['x'] }] },
    { filters: [{ column: 'status; DROP TABLE main.s.orders', op: '=', values: ['x'] }] },
    { filters: [{ column: 'status', op: '=', values: ["x'; DROP TABLE main.s.orders; --"] }] },
    { filters: [{ column: 'status', op: '=', values: ['x /* comment */'] }] },
    { filters: [{ column: 'status', op: '=', values: ['a'] }], window: { column: 'transaction_time', last_n: '1; DELETE FROM main.s.orders', unit: 'year' } },
    { filters: [{ column: 'status', op: 'like', values: ['%x%'] }] },
  ]) {
    const got = VS.filterFrom(reply(bad), COLUMNS);
    assert.equal(got.ok, false, `rejected: ${JSON.stringify(bad)}`);
    assert.ok(String(got.reason || '').length > 0, 'a rejection says why');
  }
});

test('L1 security: an ordinary value that only contains a keyword-like word is still accepted (no over-blocking)', () => {
  const got = VS.filterFrom(reply({ filters: [{ column: 'status', op: 'in', values: ['update pending', 'created'] }], window: null, unmatched: [] }), COLUMNS);
  assert.equal(got.ok, true, got.reason);
  assert.deepEqual(got.filters[0].values, ['update pending', 'created']);
});

test('L1: an unknown column is unmatched with close column names, and is never compiled', () => {
  const got = VS.filterFrom(reply({ filters: [{ column: 'region', op: 'in', values: ['North', 'East'] }, { column: 'status', op: '=', values: ['completed'] }], window: null, unmatched: [] }), COLUMNS);
  assert.equal(got.ok, true, got.reason);
  assert.deepEqual(got.filters, [{ column: 'status', op: '=', values: ['completed'] }]);
  assert.equal(got.unmatched.length, 1);
  assert.equal(got.unmatched[0].column, 'region');
  assert.ok(got.unmatched[0].close.includes('region_name'), JSON.stringify(got.unmatched[0]));
});

test('L1: browser-sent structured filters (the builder when the model is down) go through the same checks', () => {
  assert.equal(VS.checkFilters([{ column: 'status', op: '=', values: ['paid'] }], COLUMNS).ok, true);
  assert.equal(VS.checkFilters([{ column: 'status', op: '=', values: ["paid'; DROP TABLE x; --"] }], COLUMNS).ok, false);
  assert.equal(VS.checkFilters([{ column: 'status', op: 'between', values: ['a'] }], COLUMNS).ok, false, 'between needs two values');
  assert.equal(VS.checkFilters([{ column: 'status', op: 'is null', values: [] }], COLUMNS).ok, true);
  const unknown = VS.checkFilters([{ column: 'nope', op: '=', values: ['x'] }], COLUMNS);
  assert.equal(unknown.ok, true);
  assert.deepEqual(unknown.filters, []);
  assert.equal(unknown.unmatched[0].column, 'nope');
});

test('L1: a relative window resolves against the last date IN THE DATA, not today, and is stored as absolute dates', () => {
  assert.deepEqual(VS.resolveWindow({ column: 'transaction_time', last_n: 1, unit: 'year' }, '2026-09-30'),
    { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30', last_n: 1, unit: 'year' });
  assert.deepEqual(VS.resolveWindow({ column: 'transaction_time', last_n: 12, unit: 'month' }, '2026-09-30T23:10:00Z'),
    { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30', last_n: 12, unit: 'month' });
  assert.equal(VS.resolveWindow({ column: 'shipped_at', last_n: 30, unit: 'day' }, '2026-09-30').start, '2026-09-01');
});

test('L1 security: the compiled count is ONE read-only SELECT with rows_before and rows_after, every value bound, no ";"', () => {
  const scope = { filters: [{ column: 'order_type', op: '!=', values: ['test'] }, { column: 'status', op: 'in', values: ['paid', 'shipped'] }],
    window: { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30' } };
  const made = VS.scopeCountSql(GP, {}, TABLE, scope);
  assert.match(made.sql, /^SELECT COUNT\(\*\) AS rows_before, COUNT_IF\(.+\) AS rows_after FROM /s);
  assert.doesNotMatch(made.sql, /;/);
  assert.doesNotMatch(made.sql, /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|MERGE|TRUNCATE|GRANT)\b/i);
  for (const literal of ['test', 'paid', 'shipped', '2025-10-01', '2026-09-30']) {
    assert.ok(!made.sql.includes(literal), `${literal} is bound, not written into the SQL`);
    assert.ok((made.parameters || []).some((p) => String(p.value) === literal), `${literal} is a parameter`);
  }
  assert.match(made.sql, /`order_type`/);
  assert.match(made.sql, /`transaction_time`/);
});

test('L1: the count runs through the Data Filters of the use case (previewFrom), so they still apply', () => {
  const scopes = { [TABLE]: { columns: [], rows: [{ column: 'region_name', op: '=', values: ['north'] }] } };
  const made = VS.scopeCountSql(GP, scopes, TABLE, { filters: [{ column: 'status', op: '=', values: ['paid'] }], window: null });
  assert.ok((made.parameters || []).some((p) => p.value === 'north'), allText(made));
  assert.ok((made.parameters || []).some((p) => p.value === 'paid'), allText(made));
});

test('L1: the facts statement counts rows, dated rows and the range of every date column; facts come back as plain dates', () => {
  const dates = COLUMNS.filter((c) => /^(date|timestamp)/i.test(c.data_type));
  const made = VS.factsSql(GP, {}, TABLE, dates, 'transaction_time');
  for (const alias of ['rows_total', 'dated_rows', 'first_day', 'last_day', 'c0_first', 'c0_last', 'c1_first', 'c1_last']) assert.match(made.sql, new RegExp(`AS ${alias}\\b`));
  assert.doesNotMatch(made.sql, /;/);
  const facts = VS.factsFrom({ rows_total: '3412880', dated_rows: '3400840', first_day: '2019-01-01T00:00:00.000Z', last_day: '2026-09-30T18:00:00.000Z',
    c0_first: '2019-01-01T00:00:00.000Z', c0_last: '2026-09-30T18:00:00.000Z', c1_first: '2019-01-03', c1_last: '2026-10-02' }, dates, 'transaction_time');
  assert.deepEqual(facts, { rows: 3412880, dated_rows: 3400840, first: '2019-01-01', last: '2026-09-30', date_column: 'transaction_time',
    date_candidates: [{ column: 'transaction_time', first: '2019-01-01', last: '2026-09-30' }, { column: 'shipped_at', first: '2019-01-03', last: '2026-10-02' }] });
});

test('L1: the echo is built from the structure and the counts, never from the model text', () => {
  const echo = VS.echoOf({ filters: [{ column: 'order_type', op: '!=', values: ['test'] }],
    window: { column: 'transaction_time', start: '2025-10-01', end: '2026-09-30', last_n: 12, unit: 'month' }, rows_before: 3412880, rows_after: 1198406 }, 'transaction');
  assert.match(echo, /^I kept transactions where /);
  assert.match(echo, /transaction_time is from 1 Oct 2025 to 30 Sep 2026/);
  assert.match(echo, /last 12 months of your data/);
  assert.match(echo, /order_type is not test/);
  assert.match(echo, /1,198,406 of 3,412,880 rows \(35%\)/);
  assert.doesNotMatch(echo, /MODEL_ECHO_TEXT/);
  assert.match(VS.echoOf({ filters: [], window: null, rows_before: 10, rows_after: 10 }, 'record'), /all 10 rows/i);
});
