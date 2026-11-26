// SEC-12 (c23 security audit): undoing saved Calculate answers takes the owner-or-manager rule like the sibling writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/routePolicy');

test('SEC-12: POST /api/inspire/value/answers/undo is limited to an owner of the use case or an App manager', () => {
  const entry = P.ROUTE_POLICY['POST /api/inspire/value/answers/undo'];
  assert.equal(entry.rule, 'owners');
  assert.equal(typeof entry.target, 'function', 'the rule names the use case it checks');
});
