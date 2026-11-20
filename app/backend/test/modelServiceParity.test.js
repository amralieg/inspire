// REQ-422: one rule, three copies (notebook, installer, App backend). Each copy is checked against the same cases file, so a drift in
// any copy fails here or in its own language's parity test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { systemModelService } = require('../lib/modelAccess');
const { cases } = require('./support/modelServiceCases.json');

test('the App backend maps every case in the shared fixture to the same model service', () => {
  for (const { endpoint, service } of cases) {
    assert.equal(systemModelService(endpoint), service, `endpoint ${JSON.stringify(endpoint)}`);
  }
});
