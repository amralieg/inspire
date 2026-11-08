const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../frontend/src/lib/discoveryType.js');

test('the two discovery modes, their legacy values and the recommended default', () => {
  assert.deepEqual(D.DISCOVERY_TYPE_VALID, ['Standard Discovery', 'AI Enhanced Discovery']);
  assert.equal(D.DISCOVERY_TYPE_DEFAULT, 'Standard Discovery');
  assert.equal(D.DISCOVERY_RECOMMENDED, 'AI Enhanced Discovery', 'Get Started recommends and preselects AI Enhanced Discovery');
  assert.notEqual(D.DISCOVERY_RECOMMENDED, D.DISCOVERY_TYPE_DEFAULT, 'a run that names no mode still reads as Standard Discovery (must-exclude)');
  for (const [stored, mode] of [['Standard', 'Standard Discovery'], ['deep', 'AI Enhanced Discovery'], ['Deep Discovery', 'AI Enhanced Discovery'],
    [' ai enhanced discovery ', 'AI Enhanced Discovery'], ['STANDARD DISCOVERY', 'Standard Discovery']]) {
    assert.equal(D.discoveryTypeOf(stored), mode, stored);
  }
  assert.equal(D.discoveryTypeOf(''), '');
  assert.equal(D.discoveryTypeOf(null), '');
  assert.equal(D.discoveryTypeOf('Shallow'), null, 'an unknown value is never guessed into a mode');
  assert.equal(D.canonicalDiscoveryType('Shallow'), 'Standard Discovery');
  assert.equal(D.canonicalDiscoveryType(undefined), 'Standard Discovery');
});

test('only AI Enhanced Discovery shows the aggregates to the AI (must-exclude)', () => {
  assert.equal(D.aiSeesAggregates('AI Enhanced Discovery'), true);
  assert.equal(D.aiSeesAggregates('Deep'), true);
  for (const value of ['Standard Discovery', 'Standard', '', null, 'Shallow']) assert.equal(D.aiSeesAggregates(value), false, String(value));
  for (const mode of D.DISCOVERY_TYPE_VALID) {
    assert.ok(D.DISCOVERY_MODE_TEXT[mode].length > 40, mode);
    assert.doesNotMatch(D.DISCOVERY_MODE_TEXT[mode], /\u2014|\u2013/, 'no dashes in UI text');
  }
});
