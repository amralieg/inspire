const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_FIXTURES = path.join(__dirname, 'fixtures');
const AGENT_FIXTURES = path.resolve(__dirname, '..', '..', 'agent', 'tests', 'fixtures');
const names = (dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();

test('a fixture the agent and the App both read lives once, in the agent fixtures, so the two can never differ', () => {
  const agent = new Set(names(AGENT_FIXTURES));
  assert.deepEqual(names(APP_FIXTURES).filter((name) => agent.has(name)), [], 'read these from agent/tests/fixtures and delete the App copy');
  for (const name of ['implement_change_classes.json', 'implement_notebook_parity.json', 'implement_review_link_cases.json',
    'implement_spec_parity.json', 'implement_table_change_cases.json']) {
    assert.ok(agent.has(name), name);
  }
});

test('the First run read rule has one cases fixture that the notebook reader and runScope.js are both tested against', () => {
  const name = 'run_scope_legacy_cases.json';
  const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
  assert.ok(fs.existsSync(path.join(AGENT_FIXTURES, name)), name);
  assert.match(read('agent', 'tests', 'unit', 'v197_run_scope_legacy_read_test.py'), new RegExp(`"${name}"`), 'the Python reader test reads it');
  const js = read('backend', 'test', 'runScope.test.js');
  assert.match(js, new RegExp(`agent/tests/fixtures/${name}`), 'the runScope.js test reads it');
  assert.doesNotMatch(js, /\['5', RECORDED_RUN_SCOPE|LEGACY_VALUES/, 'no second table of cases in the JS test');
  const cases = JSON.parse(fs.readFileSync(path.join(AGENT_FIXTURES, name), 'utf8'));
  assert.ok(cases.read.length >= 20 && cases.unrecorded_default.length >= 5, 'the cases cover the mapping and the fallback');
});
