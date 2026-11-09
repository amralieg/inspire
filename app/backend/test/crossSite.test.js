const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const X = require('../lib/crossSite');

test.after(() => S.stopServer());

const launch = { params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7101' } };
const submitted = () => S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));
const DELETE_SESSION = `/api/inspire/session?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=7101`;

test('a page on another site, another App on the same domain included, cannot launch, delete or press a button in a hosted App as the signed-in person (must-exclude)', async () => {
  const attacks = [
    ['POST', '/api/run', launch, { 'sec-fetch-site': 'cross-site' }],
    ['POST', '/api/run', launch, { 'sec-fetch-site': 'same-site' }],
    ['POST', '/api/run', launch, { origin: 'https://evil.example.com' }],
    ['POST', '/api/run', launch, { origin: 'null' }],
    ['DELETE', DELETE_SESSION, undefined, { 'sec-fetch-site': 'cross-site' }],
    ['POST', '/run/abcdef0123/api/records/act', { action: 'approve' }, { 'sec-fetch-site': 'same-site' }],
  ];
  for (const [method, path, body, headers] of attacks) {
    S.reset({ notebookPresent: true, sessionLaunchers: { 7101: 'nonowner@example.com' } });
    const got = await S.request(method, path, { body, headers });
    const label = `${method} ${path} ${JSON.stringify(headers)}`;
    assert.equal(got.status, 403, `${label}: ${got.text.slice(0, 200)}`);
    assert.equal(got.data.cross_site, true, label);
    assert.equal(got.data.error, X.CROSS_SITE_REFUSAL, label);
    assert.deepEqual(submitted(), [], `${label}: nothing reached Databricks`);
    assert.deepEqual(S.state.calls.filter((c) => c.category === 'action'), [], label);
  }
});

test('Inspire pages, tools without browser headers, and reads from anywhere still work', async () => {
  const { port } = await S.startServer();
  for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }, {}, { origin: `http://127.0.0.1:${port}` }]) {
    S.reset({ notebookPresent: true });
    const got = await S.request('POST', '/api/run', { body: launch, headers });
    assert.equal(got.status, 200, `${JSON.stringify(headers)}: ${got.text.slice(0, 200)}`);
  }
  S.reset({});
  const read = await S.request('GET', '/api/health', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.notEqual(read.status, 403, read.text.slice(0, 200));
});

test('the cross-site rule decides the same way in isolation', () => {
  const req = (method, headers) => ({ method, headers: { host: 'inspire.example.com', ...headers }, protocol: 'https' });
  assert.equal(X.crossSiteProblem(req('GET', { 'sec-fetch-site': 'cross-site' })), '');
  assert.equal(X.crossSiteProblem(req('PUT', { 'sec-fetch-site': 'same-site' })), X.CROSS_SITE_REFUSAL);
  assert.equal(X.crossSiteProblem(req('PATCH', { origin: 'https://inspire.example.com' })), '');
  assert.equal(X.crossSiteProblem(req('POST', { origin: 'https://inspire.example.com.evil.io' })), X.CROSS_SITE_REFUSAL);
  assert.equal(X.crossSiteProblem(req('POST', { 'sec-fetch-site': 'same-origin', origin: 'https://evil.io' })), '', 'a browser that sends Sec-Fetch-Site is judged by it');
  assert.equal(X.crossSiteProblem({ method: 'POST', headers: { host: 'a.example.com', 'x-forwarded-host': 'inspire.example.com', origin: 'https://inspire.example.com' } }), '');
});
