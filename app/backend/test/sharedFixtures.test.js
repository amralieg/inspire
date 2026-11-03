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
