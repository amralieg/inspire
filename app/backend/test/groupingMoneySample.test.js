const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const GP = require('../lib/groupingProfile.js');
// The statement's SQL, read with an empty set of Data Filters (no scope) so the text stays the same as before the scopes.
const sqlOf = (build, ...args) => { const made = build(...args, {}); return made === null ? null : made.sql; };

test('the example picks the first amount-like numeric column, with its currency and status when the table has them', () => {
  const columns = [{ column_name: 'channel', data_type: 'STRING' }, { column_name: 'total_amount', data_type: 'DECIMAL(12,2)' },
    { column_name: 'currency_code', data_type: 'STRING' }, { column_name: 'ticket_status', data_type: 'STRING' }];
  assert.deepEqual(GP.moneySampleColumns(columns), { amount: 'total_amount', currency: 'currency_code', status: 'ticket_status' });
});

test('a table with no amount-like numeric column gets no example at all', () => {
  assert.equal(GP.moneySampleColumns([{ column_name: 'channel', data_type: 'STRING' }, { column_name: 'amount_text', data_type: 'STRING' }]), null);
  assert.equal(GP.moneySampleColumns([]), null);
});

test('the example reads three rows of the main table and names only the columns it picked', () => {
  const sql = GP.moneySampleSql({ sql: '`c`.`s`.`t`' }, { amount: 'total_amount', currency: '', status: 'ticket_status' });
  assert.equal(sql, 'SELECT `total_amount`, `ticket_status` FROM `c`.`s`.`t` LIMIT 3');
  assert.equal(GP.MONEY_SAMPLE_ROWS, 3);
});

test('the profile route returns the example with the profile', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  assert.match(route, /money_sample: pick \? \{ \.\.\.pick, rows: example \} : null/);
});

test('the rate sample route is wired and asks for the person sign-in', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  assert.match(route, /app\.post\('\/api\/money\/rate-sample', requireToken/);
  const policy = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routePolicy.js'), 'utf8');
  assert.match(policy, /'POST \/api\/money\/rate-sample'/);
});

test('the rate sample statement refuses a table name, a column or a base that is not plain', () => {
  const ok = { table: 'main.fx.rates', currency_column: 'from_code', base_column: 'to_code', date_column: 'rate_date', rate_column: 'rate', load_column: 'loaded_at' };
  assert.ok(sqlOf(GP.rateSampleSql, ok, 'USD').includes('LIMIT 3'));
  assert.equal(sqlOf(GP.rateSampleSql, { ...ok, table: 'main.fx;drop' }, 'USD'), null);
  assert.equal(sqlOf(GP.rateSampleSql, { ...ok, rate_column: 'rate; drop' }, 'USD'), null);
  assert.equal(sqlOf(GP.rateSampleSql, ok, 'usd'), null);
});

test('the rate column sample reads three rates of the use case table, and refuses names that are not plain', () => {
  const sql = sqlOf(GP.rateColumnSampleSql, 'main.sales.orders', 'currency_code', 'fx_rate');
  assert.equal(sql, 'SELECT `currency_code` AS currency, CAST(`fx_rate` AS DOUBLE) AS rate FROM `main`.`sales`.`orders` WHERE `fx_rate` IS NOT NULL LIMIT 3');
  assert.equal(sqlOf(GP.rateColumnSampleSql, 'main.sales.orders', 'currency_code', 'fx; drop'), null);
  assert.equal(sqlOf(GP.rateColumnSampleSql, 'main.sales;drop', 'currency_code', 'fx_rate'), null);
});
