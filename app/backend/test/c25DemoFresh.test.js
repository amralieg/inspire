// C25 (REQ-560): a shipped demo recorded by an older build (no values, no documents, no MVP App, no build stamp) must not ship.
// Stays red until the coordinator re-records the demos from the installed rc build.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/showcase');

test('there is at least one shipped demo', () => {
  assert.ok(Object.keys(S.loadShowcases()).length >= 1);
});

for (const [id, bundle] of Object.entries(S.loadShowcases())) {
  test(`the shipped demo ${id} has values, documents, an MVP App and the build stamp it was made with`, () => {
    assert.deepEqual(S.showcaseStale(bundle), []);
  });
}
