// SEC-04 (c23 security audit): create-schema never runs as the App on a place a person names.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/routePolicy');

test('SEC-04: create-schema takes the person own sign-in, so the person right to create decides, not the App', () => {
  const key = 'POST /api/inspire/implement/create-schema';
  assert.equal(P.identityFor(key), 'person');
  assert.ok(P.ROUTE_POLICY[key].scopes.includes('sql'));
});

test('SEC-04: the route writes the schema, its tags and its builder grant with the request token, and only the control log with the App token', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  const route = src.slice(src.indexOf("'/api/inspire/implement/create-schema'"), src.indexOf("'/api/inspire/implement/create-schema'") + 6000);
  assert.match(route, /executeSql\(req\.dbHost, token, warehouseId, G\.createPlaceSql/);
  assert.match(route, /appSql = await appTokenOf\(req\)/);
});
