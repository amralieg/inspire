// SEC-15 (c23 security audit): /api/auth/sp-token is a local-development helper. A production App does not register it, and logs no token error text.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

test('SEC-15: in production POST /api/auth/sp-token is not a route and no Azure request is made', async () => {
  S.reset();
  const got = await S.request('POST', '/api/auth/sp-token', { body: { client_id: 'a', client_secret: 'b', tenant_id: 'c', databricks_host: 'https://h' } });
  assert.equal(got.status, 404, got.text);
  assert.ok(!S.state.calls.some((c) => /login\.microsoftonline/.test(c.path) || c.path.includes('oauth2/v2.0/token')), 'Azure AD was called');
});

test('SEC-15: the route handler logs no error text from the token exchange', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf("'/api/auth/sp-token'");
  const handler = src.slice(start, src.indexOf('Workspace File Operations', start));
  assert.ok(!/console\.(error|log|warn)\([^)]*errText/.test(handler), 'the AAD error text is logged');
});
