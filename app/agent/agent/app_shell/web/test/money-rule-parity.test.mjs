import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftOf, ruleOf } from '../src/moneyRule.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', '..', '..', '..', 'backend', 'test', 'fixtures', 'money_rule_cases.json');
const cases = JSON.parse(readFileSync(FIXTURE, 'utf8')).cases;

for (const c of cases) {
  test(`the web draft and the Inspire backend agree on money rule "${c.name}"`, () => {
    const { rule, problems } = ruleOf(draftOf(c.rule));
    assert.equal(problems.length === 0, c.valid, problems.join('; '));
    if (c.valid) assert.deepEqual(rule, c.clean);
  });
}
