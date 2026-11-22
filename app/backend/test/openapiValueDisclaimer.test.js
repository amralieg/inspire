const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

// REQ-434: every value answer carries the full disclaimer (server.js and implementRoutes.js send `disclaimer`), so the contract names it.
const ROUTES = [['get', '/api/inspire/value'],
  ['get', '/api/inspire/value/yearly'], ['post', '/api/inspire/value/estimate']];
const missing = (doc) => ROUTES.filter(([method, p]) => {
  const schema = doc.paths?.[p]?.[method]?.responses?.['200']?.content?.['application/json']?.schema;
  return schema?.properties?.disclaimer?.type !== 'string';
}).map(([method, p]) => `${method.toUpperCase()} ${p}`);

test('every value answer documents its disclaimer string, and a schema without it is reported (must-fail)', () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8'));
  assert.deepEqual(missing(doc), []);
  const broken = { paths: { '/api/inspire/value': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: {} } } } } } } } } };
  assert.ok(missing(broken).includes('GET /api/inspire/value'));
});
