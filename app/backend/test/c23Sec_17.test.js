// SEC-17 (c23 security audit): a read that can fill the cache table is a POST, so the cross-site guard covers it.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/routePolicy');
const { registerMacroRoutes } = require('../macroRoutes');

test('SEC-17: the macro series route is POST only, and the policy names the POST', () => {
  const seen = [];
  const app = { get: (path) => seen.push(`GET ${path}`), post: (path) => seen.push(`POST ${path}`) };
  registerMacroRoutes(app, { requireToken: () => {}, executeSql: async () => ({}), sqlResultToObjects: () => [], fetchImpl: async () => ({}) });
  assert.ok(seen.includes('POST /api/inspire/macro/series'));
  assert.ok(!seen.includes('GET /api/inspire/macro/series'));
  assert.ok(P.ROUTE_POLICY['POST /api/inspire/macro/series']);
  assert.equal(P.ROUTE_POLICY['GET /api/inspire/macro/series'], undefined);
});

test('SEC-16: the samples copy route, whose raw SP error text reached the person, is gone', () => {
  assert.equal(P.ROUTE_POLICY['POST /api/inspire/samples/copy'], undefined);
});
