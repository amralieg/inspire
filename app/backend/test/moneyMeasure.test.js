const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const GP = require('../lib/groupingProfile');
const { moneyRuleProblems, moneyRuleClean } = require('../lib/moneyRule');

const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
const TABLE = 'main.sales.orders';

test('the equation becomes SQL with every column quoted and the operators kept in their order', () => {
  const sql = GP.moneyValueSampleSql(TABLE, { method: 'equation', expression: 'quantity * unit_price - discount', currency_column: 'currency' });
  assert.match(sql, /CAST\(\(\(`quantity` \* `unit_price`\) - `discount`\) AS DOUBLE\) AS stake/);
  assert.match(sql, /`currency` AS currency FROM `main`\.`sales`\.`orders`/);
  assert.match(sql, /LIMIT 3$/, 'the preview is three rows');
});

test('a fixed amount is a literal and its currency is a checked code, so no text reaches the SQL', () => {
  assert.match(GP.moneyValueSampleSql(TABLE, { method: 'fixed', amount: 120, currency: 'USD' }), /CAST\(120 AS DOUBLE\) AS stake, 'USD' AS currency/);
  assert.equal(GP.moneyValueSampleSql(TABLE, { method: 'fixed', amount: 120, currency: "USD' OR 1=1" }), null);
});

test('an equation with an operator outside the grammar builds no SQL at all', () => {
  assert.equal(GP.moneyValueSampleSql(TABLE, { method: 'equation', expression: 'quantity ^ 2', currency: 'USD' }), null);
  assert.equal(GP.moneyValueSampleSql(TABLE, { method: 'equation', expression: 'quantity; DROP TABLE x', currency: 'USD' }), null);
});

test('a column value reads that column, and a table name that is not a plain name builds nothing', () => {
  assert.match(GP.moneyValueSampleSql(TABLE, { method: 'column', column: 'amount', currency: 'AED' }), /CAST\(`amount` AS DOUBLE\) AS stake/);
  assert.equal(GP.moneyValueSampleSql('main.sales.orders; drop', { method: 'column', column: 'amount', currency: 'AED' }), null);
  assert.equal(GP.moneyValueSampleSql(TABLE, { method: 'column', column: 'amount; x', currency: 'AED' }), null);
});

test('the currency spread lists each currency of the table once, most rows first', () => {
  const sql = GP.currencySpreadSql(TABLE, 'currency');
  assert.match(sql, /SELECT `currency` AS currency, COUNT\(\*\) AS records FROM `main`\.`sales`\.`orders`/);
  assert.match(sql, /GROUP BY `currency` ORDER BY records DESC$/, 'no cap: a currency beyond 50 is never dropped');
  assert.doesNotMatch(sql, /LIMIT/);
  assert.equal(GP.currencySpreadSql('bad name!', 'currency'), null);
});

test('a value saved in a money rule is kept by the backend cleaner, and a bad one is refused before it is saved', () => {
  const rule = { currency: 'per_currency', value: { method: 'equation', expression: 'qty * price', currency_column: 'currency' } };
  assert.deepEqual(moneyRuleProblems(rule), []);
  assert.deepEqual(moneyRuleClean(rule).value, { method: 'equation', expression: 'qty * price', currency_column: 'currency' });
  assert.notEqual(moneyRuleProblems({ currency: 'per_currency', value: { method: 'equation', expression: 'qty ^ 2', currency: 'USD' } }).length, 0);
});

test('the money preview and currency routes check a person’s sign-in and read only', () => {
  for (const route of ["app.post('/api/money/currency-rates', requireToken", "app.post('/api/money/value-preview', requireToken"]) {
    assert.ok(ROUTES.includes(route), `${route} is registered behind the person's sign-in`);
  }
  assert.match(ROUTES, /FX\.currencyRates\(\{ base, codes: currencies\.map/);
});
