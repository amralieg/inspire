// Moved from routeOutputAndRuns.test.js (SEC-15, c23): the sp-token helper exists only in local development, so this file runs the server that way.
process.env.SERVER_APP_LOCAL_DEV = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

test('a tenant id typed into the sign-in form stays one path segment of the Microsoft token address (must-exclude)', async () => {
  S.reset({});
  await S.request('POST', '/api/auth/sp-token', { body: { client_id: 'c', client_secret: 's', tenant_id: '../common/../x?y=1', databricks_host: 'https://workspace.example.com' } });
  const asked = S.state.calls.map((c) => c.path);
  assert.ok(asked.includes('/..%2Fcommon%2F..%2Fx%3Fy%3D1/oauth2/v2.0/token'), asked.join(' | '));
});
