const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');

function handlerOf(source, route) {
  const start = source.indexOf(`'${route}'`);
  assert.ok(start >= 0, `${route} is registered`);
  const next = source.indexOf("app.", start + route.length);
  return source.slice(start, next > 0 ? next : start + 2000);
}

test('the browse and read routes that look at Unity Catalog run with the signed-in person, not the App', () => {
  const policy = read('lib/routePolicy.js');
  for (const route of ["'GET /api/catalogs'", "'GET /api/catalogs/:catalog/schemas'", "'GET /api/tables/:catalog/:schema'",
    "'GET /api/inspire/implement/columns'", "'GET /api/inspire/implement/values'", "'POST /api/inspire/implement/readiness'",
    "'POST /api/inspire/implement/group-counts'"]) {
    const line = policy.split('\n').find((l) => l.includes(route));
    assert.ok(line && line.includes("yours("), `${route} reads with the person's token`);
  }
});

test('the Data groups profile and the money reads of a use case table read with the person token', () => {
  const impl = read('implementRoutes.js');
  for (const route of ['/api/grouping/profile', '/api/money/currency-rates', '/api/money/value-preview', '/api/money/rate-sample']) {
    const body = handlerOf(impl, route);
    assert.ok(/P\.personTokenOf\(req\)|personTokenOf\(req\)/.test(body), `${route} takes the person token for its table reads`);
  }
});
