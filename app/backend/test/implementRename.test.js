const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateImplementSpec, implementChangeSummary } = require('../lib/inspireImplement');

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'agent', 'tests', 'fixtures', 'implement_change_classes.json'), 'utf8'));
const CASE = FIXTURE.cases.find((c) => c.name === 'display name changed on a built App');

test('a display-name change on a built App is a restyle of that App, not an unchanged spec', () => {
  const previous = validateImplementSpec(CASE.previous).spec;
  const current = validateImplementSpec(CASE.current).spec;
  const summary = implementChangeSummary(previous, current, { dashboard: 'd1', genie_space: 'g1', app: 'churn-desk' }, CASE.built_settings);
  assert.deepEqual(summary.classes, ['name']);
  assert.deepEqual(summary.refresh, ['app']);
  assert.deepEqual(summary.build, []);
  assert.equal(summary.refill, false);
  assert.equal(summary.nothing_to_do, false, 'the name change must reach the build, not the unchanged refusal');
});

test('a name-only change with no built App refreshes nothing, so the planner never restyles an App that is not there (must-exclude)', () => {
  const previous = validateImplementSpec(CASE.previous).spec;
  const current = validateImplementSpec(CASE.current).spec;
  const summary = implementChangeSummary(previous, current, { dashboard: 'd1' }, CASE.built_settings);
  assert.deepEqual(summary.refresh, []);
});
