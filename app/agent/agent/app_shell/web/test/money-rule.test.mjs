import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftOf, ruleOf, ruleSentence } from '../src/moneyRule.js';

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
