const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { moneyRuleProblems, moneyRuleClean } = require('../lib/moneyRule.js');

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'money_rule_cases.json'), 'utf8')).cases;

for (const c of CASES) {
  test(`money rule "${c.name}" is ${c.valid ? 'accepted' : 'refused'} and cleans to its fixture`, () => {
    const problems = moneyRuleProblems(c.rule);
    assert.equal(problems.length === 0, c.valid, problems.join('; '));
    if (c.valid) assert.deepEqual(moneyRuleClean(c.rule), c.clean);
  });
}

// REQ-103: a column-rate rule needs the currency column of each row. An old saved rule without it still reads, and the
// validator asks for it, so a rebuild is refused with the question rather than run with no currency.
test('a column-rate rule with no currency column asks for it; an old saved rule still cleans without it (fail-pre: it was accepted)', () => {
  const old = { currency: 'convert', base: 'AED', rate_column: 'fx_rate' };
  const problems = moneyRuleProblems(old);
  assert.ok(problems.some((p) => /needs currency_column/.test(p)), problems.join(' | '));
  assert.deepEqual(moneyRuleClean(old), { currency: 'convert', base: 'AED', rate_column: 'fx_rate' });
});

test('a column-rate rule with both columns is valid and keeps both through the clean step', () => {
  const rule = { currency: 'convert', base: 'AED', rate_column: 'fx_rate', currency_column: 'ccy' };
  assert.deepEqual(moneyRuleProblems(rule), []);
  assert.deepEqual(moneyRuleClean(rule), rule);
});

test('a currency column that is not a plain column name is refused', () => {
  assert.ok(moneyRuleProblems({ currency: 'convert', base: 'AED', rate_column: 'fx_rate', currency_column: 'a b; drop' }).some((p) => /currency_column/.test(p)));
});
