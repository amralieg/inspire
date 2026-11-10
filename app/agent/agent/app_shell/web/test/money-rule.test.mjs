import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftOf, previewLines, ruleOf, ruleSentence } from '../src/moneyRule.js';

test('the default rule is per currency with no rates to type', () => {
  assert.deepEqual(ruleOf(draftOf(null)), { rule: { currency: 'per_currency' }, problems: [] });
  assert.match(ruleSentence({ currency: 'per_currency' }), /totalled on its own/);
});

test('a converted rule round-trips through the draft and says the rates in plain words', () => {
  const rule = { currency: 'convert', base: 'USD', rates: { AED: 0.27, EUR: 1.08 } };
  assert.deepEqual(ruleOf(draftOf(rule)), { rule, problems: [] });
  assert.match(ruleSentence(rule), /converted to USD at the rates you typed in \(1 AED = 0.27 USD, 1 EUR = 1.08 USD\)/);
});

test('a converted rule with no base, no rates, a bad code or a zero rate is refused with the reason', () => {
  const problems = (draft) => ruleOf(draft).problems;
  assert.ok(problems({ mode: 'convert', base: 'dollars', rates: [{ code: 'AED', rate: '0.27' }] }).some((p) => /base currency/.test(p)));
  assert.ok(problems({ mode: 'convert', base: 'USD', rates: [] }).some((p) => /at least one rate/.test(p)));
  assert.ok(problems({ mode: 'convert', base: 'USD', rates: [{ code: 'AE', rate: '0.27' }] }).some((p) => /three-letter/.test(p)));
  assert.ok(problems({ mode: 'convert', base: 'USD', rates: [{ code: 'AED', rate: '0' }] }).some((p) => /positive number/.test(p)));
  assert.ok(problems({ mode: 'convert', base: 'USD', rates: [{ code: 'AED', rate: '1' }, { code: 'AED', rate: '2' }] }).some((p) => /two rates/.test(p)));
});

test('the preview shows each total, the largest rows and the left-out line in plain words', () => {
  const lines = previewLines({ totals: [{ currency: 'AED', now: 215177.03 }, { currency: 'USD', now: null }], top: [{ currency: 'USD', amount: 50 }], left_out: { text: '2 rows without a date were left out' }, rule: { base: 'USD' } });
  assert.deepEqual(lines.totals, ['AED 215,177', 'USD no rows']);
  assert.deepEqual(lines.top, ['USD 50']);
  assert.equal(lines.leftOut, '2 rows without a date were left out');
});

import { formulaLine, workedExample } from '../src/moneyRule.js';

test('the worked example runs each sample row through the rule, in plain words', () => {
  const rule = { currency: 'convert', base: 'USD', rates: { AED: 0.27 }, statuses: ['used'], status_column: 'status' };
  const sample = { amount: 'total_amount', currency: 'currency_code', status: 'ticket_status', rows: [
    { total_amount: 100, currency_code: 'AED', ticket_status: 'used' },
    { total_amount: 50, currency_code: 'AED', ticket_status: 'void' },
    { total_amount: 20, currency_code: 'GBP', ticket_status: 'used' }] };
  const lines = workedExample(rule, sample);
  assert.equal(lines[0], 'AED 100 × 0.27 = 27 USD.');
  assert.equal(lines[1], 'AED 50 with status void is not counted.');
  assert.match(lines[2], /^GBP 20: its rate is read from the rate source/);
});

test('the formula line says what is counted and how each amount becomes a stake', () => {
  assert.equal(formulaLine({ currency: 'per_currency' }), 'Stake = the loss on each row in its own currency, for every row.');
  assert.match(formulaLine({ currency: 'convert', base: 'USD', rate_table: { table: 'main.fx.rates' }, rule: 'net', statuses: ['used'], status_column: 'status' }),
    /Stake = the signed amount × the rate for its currency, USD and date, for only rows whose status is used\./);
});
