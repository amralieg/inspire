import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Renders the money editor to static markup, so the layout, the defaults and old saved rules are tested without a browser.
const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'money-layout-'));
const outfile = path.join(dir, 'layout.cjs');
await build({
  stdin: {
    contents: [
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server';",
      "export { MoneyRuleEditor } from './src/components/MoneyRuleEditor.jsx';",
      "export { defaultMoneyRule, moneySummaryOf, MONEY_CURRENCY_CHOICES, WINDOW_CHOICES, valueTextOf } from './src/lib/moneyDefaults.js';",
      "export { draftOf, ruleOf } from '../agent/agent/app_shell/web/src/moneyRule.js';",
    ].join('\n'),
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const lib = createRequire(import.meta.url)(outfile);
rmSync(dir, { recursive: true, force: true });

const SAMPLE = { amount: 'total_amount', currency: 'currency_code', status: 'status' };
const COLUMNS = ['total_amount', 'currency_code', 'status', 'quantity', 'unit_price'];
const render = (props) => lib.renderToStaticMarkup(lib.createElement(lib.MoneyRuleEditor, { columns: COLUMNS, sample: SAMPLE, api: {}, ...props }));
// The markup of the one input that carries this marker, and whether it is checked.
const checkedRadio = (html, marker) => (html.match(/<input[^>]*>/g) || []).some((tag) => tag.includes(marker) && /\schecked=""/.test(tag));
const OLD_RULE = { currency: 'convert', base: 'USD', rates: { AED: 0.27, EUR: 1.08 }, window: { periods: 6 }, statuses: ['closed'], status_column: 'status', rule: 'net', value: { method: 'fixed', amount: 120, currency: 'USD' } };

test('the default rule counts the amount column in USD per record, or each record once without one', () => {
  assert.deepEqual(lib.defaultMoneyRule({ money_sample: SAMPLE }), { currency: 'per_currency', value: { method: 'column', column: 'total_amount', currency_column: 'currency_code' } });
  assert.deepEqual(lib.defaultMoneyRule({ money_sample: { amount: 'total_amount', currency: '', status: '' } }), { currency: 'per_currency', value: { method: 'column', column: 'total_amount', currency: 'USD' } });
  assert.deepEqual(lib.defaultMoneyRule(null), { currency: 'per_currency', value: { method: 'fixed', amount: 1, currency: 'USD' } });
});

test('the default rule passes the editor’s own rule check with no problem, so Next goes through with no edits', () => {
  const rule = lib.defaultMoneyRule({ money_sample: SAMPLE });
  const { problems } = lib.ruleOf({ ...lib.draftOf(rule), value: rule.value });
  assert.deepEqual(problems, []);
});

test('the currency picker lists USD first and every code the brief names, and it is an editable list', () => {
  const codes = lib.MONEY_CURRENCY_CHOICES;
  assert.deepEqual(codes.slice(0, 3), ['USD', 'EUR', 'GBP']);
  for (const code of ['AED', 'SAR', 'QAR', 'KWD', 'EGP', 'JPY', 'INR', 'CNY', 'CHF', 'CAD', 'AUD']) assert.ok(codes.includes(code), code);
  const html = render({ part: 'currency', value: OLD_RULE });
  assert.ok(html.includes('list="money-currency-codes"'), 'the code input is a list-backed text box');
  assert.ok(html.includes('<option value="AED"'), 'the datalist offers AED');
});

test('every radio sits before its label on the same row', () => {
  const html = render({ part: 'method', value: lib.defaultMoneyRule({ money_sample: SAMPLE }) });
  const radio = html.indexOf('data-money-method="column"');
  const label = html.indexOf('A value from a data column');
  assert.ok(radio > 0 && label > radio, 'the radio is written before its label');
  assert.match(html, /<label class="radio[^"]*"[^>]*><input type="radio"/, 'the radio is the first child of its row');
});

test('the details panel writes out the calculation of the chosen method and gives a worked example', () => {
  const html = render({ part: 'method', value: lib.defaultMoneyRule({ money_sample: SAMPLE }) });
  assert.ok(html.includes('data-money-details'), 'a details panel renders beside the choices');
  assert.ok(html.includes('Total = sum of this column over the records. Example: a row with 250 in total_amount adds 250.'), html);
});

test('the closed periods field is a list-backed box that says All closed periods when empty, with the plain sentence', () => {
  const html = render({ part: 'window', value: OLD_RULE });
  assert.deepEqual(lib.WINDOW_CHOICES, ['3', '6', '12', '24']);
  assert.ok(html.includes('list="money-window-choices"'));
  assert.ok(html.includes('How many past periods to add up. All adds every closed period; 12 means the last 12 months.'));
  assert.ok(html.includes('value="6"'), 'an old saved window of 6 periods loads into the box');
});

test('an old saved rule loads: its currency, value, direction, window and statuses come back', () => {
  const html = render({ part: null, value: OLD_RULE });
  assert.ok(html.includes('value="6"'), 'window');
  assert.ok(html.includes('value="closed"'), 'statuses');
  assert.ok(checkedRadio(html, 'data-money-rule-kind="net"'), 'the net direction is selected');
  assert.ok(checkedRadio(html, 'data-money-currency-mode="convert"'), 'the convert mode is selected');
  assert.ok(html.includes('120'), 'the fixed amount');
});

test('the rates block shows only when the table has more than one currency, with an example row', () => {
  const single = render({ part: 'currency', value: lib.defaultMoneyRule({ money_sample: SAMPLE }) });
  assert.ok(!single.includes('data-money-convert-rates'), 'no convert choice for one currency');
  assert.ok(!single.includes('data-money-rates'), 'no rates table');
  const multi = render({ part: 'currency', value: OLD_RULE });
  assert.ok(multi.includes('Convert every amount to one reporting currency'), 'the convert choice appears for two or more currencies');
  assert.ok(multi.includes('data-money-rate-code="true">AED'), 'the rates table lists the currencies');
});

test('the summary of a folded section says what it holds in one line', () => {
  assert.equal(lib.moneySummaryOf(OLD_RULE, 'window'), 'the last 6 closed periods, statuses closed');
  assert.equal(lib.moneySummaryOf(lib.defaultMoneyRule({ money_sample: SAMPLE }), 'method'), 'A value from a data column: the amount in total_amount, in the currency of currency_code');
  assert.equal(lib.moneySummaryOf(lib.defaultMoneyRule(null), 'direction'), 'Losses only');
  assert.equal(lib.moneySummaryOf(null, 'method'), 'Not set yet');
});

test('valueTextOf keeps the wording the rest of the App uses', () => {
  assert.equal(lib.valueTextOf({ method: 'fixed', amount: 120, currency: 'USD' }), '120 in USD, for each record');
});

test('the default is the amount the rule computes when the use case states one, and saves no value for it', () => {
  assert.deepEqual(lib.defaultMoneyRule({ money_sample: SAMPLE }, true), { currency: 'per_currency' });
  assert.equal('value' in lib.defaultMoneyRule({ money_sample: SAMPLE }, true), false);
});

test('with no amount from the rule, the default is the amount column of the table, else each record once in USD', () => {
  assert.deepEqual(lib.defaultMoneyRule({ money_sample: SAMPLE }, false).value, { method: 'column', column: 'total_amount', currency_column: 'currency_code' });
  assert.deepEqual(lib.defaultMoneyRule({ money_columns: ['order_id', 'qty'], money_sample: null }, false).value, { method: 'fixed', amount: 1, currency: 'USD' });
});

test('the default never counts a sales column named in the use case text (N01-U01: totalPrice is not the loss)', () => {
  const profile = { money_columns: ['totalPrice', 'recomputation_amount'], money_sample: null };
  assert.deepEqual(lib.defaultMoneyRule(profile, false).value, { method: 'fixed', amount: 1, currency: 'USD' });
});

test('the wizard sentence names the choice the default made, in plain words', () => {
  assert.equal(lib.moneySummaryOf(lib.defaultMoneyRule({ money_sample: SAMPLE }, true), 'method'),
    'The amount the rule computes: each flagged record counts the amount its own rule works out');
  assert.equal(lib.moneySummaryOf(lib.defaultMoneyRule({ money_sample: SAMPLE }, false), 'method'),
    'A value from a data column: the amount in total_amount, in the currency of currency_code');
  assert.equal(lib.moneySummaryOf(lib.defaultMoneyRule(null, false), 'method'), 'A fixed amount for each record: 1 in USD, for each record');
});

test('a rule with no value shows the rule’s-own choice as selected, with no currency block', () => {
  const html = render({ value: { currency: 'per_currency' }, part: 'method' });
  assert.equal(checkedRadio(html, 'data-money-method="rule"'), true);
  assert.equal(html.includes('data-money-value-currency'), false);
  assert.ok(html.includes('data-money-rule-own'));
});

test('a column the person picks in the wizard shows as chosen, and the sentence names that column', () => {
  const picked = { currency: 'per_currency', value: { method: 'column', column: 'unit_price', currency: 'USD' } };
  assert.equal(checkedRadio(render({ value: picked, part: 'method' }), 'data-money-method="column"'), true);
  assert.equal(lib.moneySummaryOf(picked, 'method'), 'A value from a data column: the amount in unit_price, in USD');
});
