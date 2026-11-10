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
