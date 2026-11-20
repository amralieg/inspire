const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RP = require('../lib/routePolicy');

const BACKEND = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');

function handlerOf(source, route) {
  const start = source.indexOf(`'${route}'`);
  assert.ok(start >= 0, `${route} is registered`);
  const next = source.indexOf("app.", start + route.length);
  return source.slice(start, next > 0 ? next : start + 2000);
}

// REQ-418 (D-SL-10B): every browse and read that looks at Unity Catalog runs as the App's service principal, never the signed-in person.
test('the browse and read routes that look at Unity Catalog run as the App, not the signed-in person', () => {
  for (const key of ['GET /api/catalogs', 'GET /api/catalogs/:catalog/schemas', 'GET /api/tables/:catalog/:schema',
    'GET /api/inspire/implement/columns', 'GET /api/inspire/implement/values', 'POST /api/inspire/implement/readiness',
    'POST /api/inspire/implement/group-counts']) {
    assert.equal(RP.identityFor(key), 'app', `${key} reads as the App`);
  }
});

test('the Data groups profile and the money reads of a use case table read as the App, and say so', () => {
  const impl = read('implementRoutes.js');
  for (const route of ['/api/grouping/profile', '/api/money/currency-rates', '/api/money/value-preview', '/api/money/rate-sample']) {
    const body = handlerOf(impl, route);
    assert.ok(/const token = req\.dbToken;/.test(body), `${route} reads with the App's token from the request`);
    assert.doesNotMatch(body, /personTokenOf/, `${route} never takes the person token for its table reads`);
    const key = `POST ${route}`;
    assert.equal(RP.identityFor(key), 'app', key);
    assert.doesNotMatch(RP.ROUTE_POLICY[key].why || RP.ROUTE_POLICY[key].action || '', /your own sign-in/, `${key} names the App, not the person`);
  }
});
