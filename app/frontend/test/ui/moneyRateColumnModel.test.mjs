import test from 'node:test';
import assert from 'node:assert/strict';
import { draftOf, ruleOf } from '../../../agent/agent/app_shell/web/src/moneyRule.js';

// REQ-103: an old saved column-rate rule (no currency_column) still loads in the Measure editor, in the column mode,
// and asks for the currency column before it saves. A complete one saves with both columns.
test('an old column-rate rule with no currency column loads in the column mode and asks for the currency column', () => {
  const draft = draftOf({ currency: 'convert', base: 'AED', rate_column: 'fx_rate' });
  assert.equal(draft.rateSource, 'column');
  assert.equal(draft.currencyColumn, '');
  const { problems } = ruleOf(draft);
  assert.ok(problems.some((p) => /Pick the currency column/.test(p)), problems.join(' | '));
});

test('a column-rate rule with both columns saves with both', () => {
  const draft = draftOf({ currency: 'convert', base: 'AED', rate_column: 'fx_rate', currency_column: 'ccy' });
  const { rule, problems } = ruleOf(draft);
  assert.deepEqual(problems, []);
  assert.equal(rule.rate_column, 'fx_rate');
  assert.equal(rule.currency_column, 'ccy');
});
