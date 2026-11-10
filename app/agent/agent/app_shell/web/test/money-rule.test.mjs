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
