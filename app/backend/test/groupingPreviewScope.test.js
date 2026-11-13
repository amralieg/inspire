// rc15 L1 follow-up (REQ-021, REQ-022): every preview and profile read of a table goes through that table's Data Filters.
// A table with no Data Filters is read as it is; a scope that does not keep a column a read needs refuses the read with the
// reason. One fail-before / pass-after pair per site: the joined read, the time-via date table, the currency spread, the
// money value sample, the rate table sample, the rate column sample, and the money routes that read them through the session.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const GP = require('../lib/groupingProfile');

const ORDERS = 'main.s.orders';
const STORES = 'main.s.stores';
const DATES = 'main.s.dates';
const RATES = 'main.fx.rates';
const ROWS_ONLY = (table, column, value) => ({ [table]: { columns: [], rows: [{ column, op: '=', values: [value] }] } });
const COLUMNS_ONLY = (table, columns) => ({ [table]: { columns, rows: [] } });
const RATE_TABLE = { table: RATES, currency_column: 'from_code', base_column: 'to_code', rate_column: 'rate', load_column: 'loaded_at' };

// 1. the joined read: a joined table's Data Filter reaches the join subquery, with its own parameter names
test('a joined table read by the profile is read through its Data Filters, with the columns it needs', () => {
  const joined = [{ name: 'brand', table: STORES, key: 'store_id', ref_column: 'store_id', column: 'brand' }];
  const got = GP.statement(ROWS_ONLY(STORES, 'region', 'north'), (ctx) => GP.statsSql({ sql: '`main`.`s`.`orders`' }, ['brand'], null, 30, joined, ctx));
  assert.match(got.sql, /LEFT JOIN \(SELECT `store_id` AS inspire_key, MAX\(`brand`\) AS `brand` FROM \(SELECT `brand`, `store_id` FROM `main`\.`s`\.`stores` WHERE/);
  assert.ok(!got.sql.includes('FROM `main`.`s`.`stores` GROUP BY'), 'the joined table is not read whole');
  assert.deepEqual(got.parameters.map((p) => p.name), ['s1_f0_0']);
});

test('a joined read whose Data Filters do not keep the column it needs is refused with the reason', () => {
  const joined = [{ name: 'brand', table: STORES, key: 'store_id', ref_column: 'store_id', column: 'brand' }];
  assert.throws(() => GP.statement(COLUMNS_ONLY(STORES, ['region']), (ctx) => GP.statsSql({ sql: '`main`.`s`.`orders`' }, ['brand'], null, 30, joined, ctx)),
    /keep only the columns region, so this read cannot use brand, store_id/);
});

test('a profile join with no statement context refuses to read the joined table at all', () => {
  const joined = [{ name: 'brand', table: STORES, key: 'store_id', ref_column: 'store_id', column: 'brand' }];
  assert.throws(() => GP.statsSql({ sql: '`main`.`s`.`orders`' }, ['brand'], null, 30, joined), /without its Data Filters/);
});

// 2. the time-via date table
test('the recent-period read of a date table is read through the date table Data Filters', () => {
  const time = { column: 'ordered_on', via: { table: DATES, key: 'date_key', date: 'day' } };
  const got = GP.statement(ROWS_ONLY(DATES, 'calendar', 'fiscal'), (ctx) => GP.statsSql({ sql: '`main`.`s`.`orders`' }, ['brand'], time, 30, [], ctx));
  assert.match(got.sql, /JOIN \(SELECT `date_key`, `day` FROM `main`\.`s`\.`dates` WHERE/);
  assert.ok(!/JOIN `main`\.`s`\.`dates` r/.test(got.sql), 'the date table is not joined whole');
  assert.throws(() => GP.statement(COLUMNS_ONLY(DATES, ['day']), (ctx) => GP.statsSql({ sql: '`main`.`s`.`orders`' }, ['brand'], time, 30, [], ctx)),
    /keep only the columns day/);
});

// 3. the currency spread
test('the currency spread reads the use case table through its Data Filters and names only the currency column', () => {
  const got = GP.currencySpreadSql(ORDERS, 'currency', ROWS_ONLY(ORDERS, 'region', 'north'));
  assert.match(got.sql, /FROM \(SELECT `currency` FROM `main`\.`s`\.`orders` WHERE CAST\(`region` AS STRING\) = :s1_f0_0\) WHERE `currency` IS NOT NULL/);
  assert.deepEqual(got.parameters, [{ name: 's1_f0_0', value: 'north', type: 'STRING' }]);
  assert.throws(() => GP.currencySpreadSql(ORDERS, 'currency', COLUMNS_ONLY(ORDERS, ['region'])), /keep only the columns region, so this read cannot use currency/);
});

// 4. the money value sample
test('the money value sample reads its amount column through the Data Filters, and a fixed amount reads only the kept rows', () => {
  const column = GP.moneyValueSampleSql(ORDERS, { method: 'column', column: 'amount', currency: 'AED' }, ROWS_ONLY(ORDERS, 'region', 'north'));
  assert.match(column.sql, /FROM \(SELECT `amount` FROM `main`\.`s`\.`orders` WHERE CAST\(`region` AS STRING\) = :s1_f0_0\) WHERE `amount` IS NOT NULL LIMIT 3/);
  const fixed = GP.moneyValueSampleSql(ORDERS, { method: 'fixed', amount: 120, currency: 'USD' }, ROWS_ONLY(ORDERS, 'region', 'north'));
  assert.match(fixed.sql, /FROM \(SELECT 1 AS inspire_row FROM `main`\.`s`\.`orders` WHERE/, 'no column is needed, so the rows are counted through a constant');
  assert.throws(() => GP.moneyValueSampleSql(ORDERS, { method: 'column', column: 'amount', currency: 'AED' }, COLUMNS_ONLY(ORDERS, ['region'])),
    /keep only the columns region, so this read cannot use amount/);
});

// 5. the rate table sample
test('the rate table sample reads its rate table through the Data Filters of that table', () => {
  const got = GP.rateSampleSql(RATE_TABLE, 'USD', ROWS_ONLY(RATES, 'to_code', 'USD'));
  assert.match(got.sql, /FROM \(SELECT `from_code` AS currency, CAST\(`rate` AS DOUBLE\) AS rate, .* FROM \(SELECT `from_code`, `to_code`, `rate`, `loaded_at` FROM `main`\.`fx`\.`rates` WHERE CAST\(`to_code` AS STRING\) = :s1_f0_0\) WHERE `to_code` = 'USD'\) AS ranked/);
  assert.throws(() => GP.rateSampleSql(RATE_TABLE, 'USD', COLUMNS_ONLY(RATES, ['from_code'])), /keep only the columns from_code, so this read cannot use to_code/);
});

// 6. the rate column sample
test('the rate column sample reads the use case table through its Data Filters', () => {
  const got = GP.rateColumnSampleSql(ORDERS, 'currency_code', 'fx_rate', ROWS_ONLY(ORDERS, 'region', 'north'));
  assert.match(got.sql, /FROM \(SELECT `currency_code`, `fx_rate` FROM `main`\.`s`\.`orders` WHERE CAST\(`region` AS STRING\) = :s1_f0_0\) WHERE `fx_rate` IS NOT NULL LIMIT 3/);
  assert.throws(() => GP.rateColumnSampleSql(ORDERS, 'currency_code', 'fx_rate', COLUMNS_ONLY(ORDERS, ['currency_code'])), /cannot use fx_rate/);
});

test('a table with no Data Filters is read as it is, and a missing session of Data Filters refuses every preview', () => {
  assert.equal(GP.currencySpreadSql(ORDERS, 'currency', {}).sql, 'SELECT `currency` AS currency, COUNT(*) AS records FROM `main`.`s`.`orders` WHERE `currency` IS NOT NULL GROUP BY `currency` ORDER BY records DESC');
  assert.throws(() => GP.currencySpreadSql(ORDERS, 'currency', undefined), /cannot read the Data Filters of this use case/);
});

// 7. the money routes read through the session's Data Filters (the route, with the session the preview names). A Launch scope names
// its columns, as the Launch page requires, so the route scopes below name them too.
const SESSION = (table_scope) => ({ business_name: 'Acme', tables_str: ORDERS, catalogs: 'main', schemas_str: 's', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify(table_scope) });
const BODY = { inspire_database: 'main.inspire', session_id: '42', use_case_id: 'N01-U01', warehouse_id: 'wh1' };
const ORDERS_SCOPE = { [ORDERS]: { columns: ['amount', 'region'], rows: [{ column: 'region', op: '=', values: ['north'] }] } };
const RATES_SCOPE = { [RATES]: { columns: ['from_code', 'to_code', 'rate', 'loaded_at'], rows: [{ column: 'to_code', op: '=', values: ['USD'] }] } };

async function post(made, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('the value preview route reads the use case table through the session Data Filters and binds their values', async () => {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION(ORDERS_SCOPE) });
  const got = await post(made, '/api/money/value-preview', { ...BODY, table: ORDERS, value: { method: 'column', column: 'amount', currency: 'AED' } });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const read = made.sqlCalls.find((c) => c.sql.includes('AS stake'));
  assert.ok(read, 'the preview ran a statement');
  assert.match(read.sql, /\(SELECT `amount`, `region` FROM `main`\.`s`\.`orders` WHERE CAST\(`region` AS STRING\) = :s1_f0_0\)/);
  assert.deepEqual(read.parameters, [{ name: 's1_f0_0', value: 'north', type: 'STRING' }]);
});

test('the value preview route refuses a column its session Data Filters do not keep, with the reason', async () => {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION({ [ORDERS]: { columns: ['region'], rows: [] } }) });
  const got = await post(made, '/api/money/value-preview', { ...BODY, table: ORDERS, value: { method: 'column', column: 'amount', currency: 'AED' } });
  assert.equal(got.status, 400);
  assert.match(JSON.stringify(got.data), /keep only the columns region, so this read cannot use amount/);
  assert.ok(!made.sqlCalls.some((c) => c.sql.includes('AS stake')), 'no statement reads the table');
});

test('the rate sample route reads the rate table through the session Data Filters', async () => {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION(RATES_SCOPE) });
  const got = await post(made, '/api/money/rate-sample', { ...BODY, rate_table: RATE_TABLE, base: 'USD' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const read = made.sqlCalls.find((c) => c.sql.includes('AS ranked'));
  assert.ok(read && /FROM \(SELECT `from_code`, `to_code`, `rate`, `loaded_at` FROM `main`\.`fx`\.`rates` WHERE CAST\(`to_code` AS STRING\) = :s1_f0_0\)/.test(read.sql), read && read.sql);
});

test('a money route without a session names no Data Filters, so it is refused before any table is read', async () => {
  const made = makeApp({ forwardedToken: 'person-tok' });
  const { session_id: _omit, ...noSession } = BODY;
  const got = await post(made, '/api/money/value-preview', { ...noSession, table: ORDERS, value: { method: 'column', column: 'amount', currency: 'AED' } });
  assert.equal(got.status, 400);
  assert.ok(!made.sqlCalls.some((c) => c.sql.includes('AS stake')), 'no statement reads the table without its session');
});

// A profile with one bad join: the joined table's Data Filters keep out the key the join needs. That joined preview is left out with one
// reason, and every other part of the profile still loads and reads only through its own Data Filters.
test('a profile whose join key is outside the Data Filters returns every other part, with one reason for the joined preview', async () => {
  const columns = [{ column_name: 'store_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'region', data_type: 'STRING', ordinal_position: 2 },
    { column_name: 'status', data_type: 'STRING', ordinal_position: 3 }];
  const made = makeApp({
    forwardedToken: 'person-tok',
    useCase: { id: 'N01-U01', primary_table: ORDERS, tables_involved: `${ORDERS}, ${STORES}`, analytics_technique: 'Anomaly Detection',
      table_joins: JSON.stringify([{ table: ORDERS, column: 'store_id', ref_table: STORES, ref_column: 'store_id' }]) },
    columns,
    session: SESSION({ [ORDERS]: { columns: ['store_id', 'region', 'status'], rows: [] }, [STORES]: { columns: ['brand'], rows: [] } }),
  });
  const srv = await listen(made.app);
  let body;
  try {
    const resp = await fetch(`${srv.url}/api/grouping/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', session_id: '42', use_case_id: 'N01-U01', warehouse_id: 'wh1' }) });
    body = { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
  assert.equal(body.status, 200, JSON.stringify(body.data));
  assert.deepEqual(body.data.refusals, [`${STORES}.store_id is outside the Data Filters scope`], 'one reason, for the joined preview');
  assert.equal(body.data.table, ORDERS, 'the main table is profiled');
  assert.ok(Number.isFinite(body.data.records) && Array.isArray(body.data.columns) && 'group_list' in body.data && 'first_run' in body.data,
    'the rest of the profile loads: records, columns, groups and the first run');
  assert.ok(!JSON.stringify(body.data.columns || []).includes('stores.'), 'the refused join adds no column to the profile');
  assert.ok(made.sqlCalls.some((c) => c.sql.includes(`\`main\`.\`s\`.\`orders\``)), 'the main table is read for the rest of the profile');
  assert.ok(!made.sqlCalls.some((c) => /FROM `main`\.`s`\.`stores`( GROUP| WHERE| LIMIT|\)|$)/.test(c.sql)), 'the joined table is not read whole');
});
