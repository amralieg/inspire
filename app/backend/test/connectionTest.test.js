// REQ-431 (F-102): the connection test runs as the App's service principal, like every other read on the hosted App.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

test('/api/connection-test reaches the workspace with the service principal token when no DATABRICKS_TOKEN is set', async () => {
  S.reset();
  S.state.managers = ['boss@example.com'];
  const got = await S.request('GET', '/api/connection-test', { person: 'boss@example.com' });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.ok, true, got.text);
  const call = S.state.calls.find((c) => c.path === '/api/2.0/sql/warehouses');
  assert.ok(call, 'the test listed the warehouses');
  assert.equal(call.token, S.APP_TOKEN);
});
