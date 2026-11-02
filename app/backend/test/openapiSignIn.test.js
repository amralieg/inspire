const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const RP = require('../lib/routePolicy');

test('every documented route that can answer the person sign-in 401 names the shared response, and a route without it is reported (must-fail)', () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8'));
  const missing = (spec, keys) => Object.entries(spec.paths || {}).flatMap(([p, ops]) => Object.entries(ops || {})
    .map(([method, op]) => [`${method.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`, op])
    .filter(([key, op]) => keys.includes(key) && !(op.responses && op.responses['401'] && op.responses['401'].$ref === '#/components/responses/PersonSignInRequired'))
    .map(([key]) => key));
  const keys = RP.personSignInRoutes();
  assert.ok(keys.includes('POST /api/run') && keys.includes('GET /api/workspace/list') && keys.includes('GET /api/inspire/session'));
  assert.ok(!keys.includes('GET /api/health') && !keys.includes('GET /api/run/:runId'));
  assert.deepEqual(missing(doc, keys), []);
  assert.ok(doc.components.responses.PersonSignInRequired, 'the shared response exists');
  const broken = { paths: { '/api/run': { post: { responses: { 401: { description: 'No token' } } } }, '/api/health': { get: { responses: {} } } } };
  assert.deepEqual(missing(broken, keys), ['POST /api/run']);
});
