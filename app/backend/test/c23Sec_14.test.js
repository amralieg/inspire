// SEC-14 (c23 security audit): /api/health shows the App's settings only to a signed-in person, /api/connection-test is for managers, and
// /api/defaults hands the installer catalogs to managers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

test('SEC-14: /api/health with no signed-in person is a bare ok with no host, database or settings', async () => {
  S.reset();
  const got = await S.request('GET', '/api/health', { person: '', signedIn: false });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.ok, true);
  assert.deepEqual(Object.keys(got.data).sort(), ['ok', 'status'], got.text);
});

test('SEC-14: /api/health still gives a signed-in person the full answer', async () => {
  S.reset();
  const got = await S.request('GET', '/api/health', { person: 'nonowner@example.com' });
  assert.equal(got.status, 200, got.text);
  assert.ok(got.data.hostFull, 'the setup page still reads the host');
});

test('SEC-14: /api/connection-test is refused to a person who is not a manager and answered to a manager', async () => {
  S.reset();
  assert.equal((await S.request('GET', '/api/connection-test', { person: 'nonowner@example.com' })).status, 403);
  S.state.managers = ['boss@example.com'];
  const got = await S.request('GET', '/api/connection-test', { person: 'boss@example.com' });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.ok, true);
});

test('SEC-14: /api/defaults carries no installer catalogs for a person who is not a manager', async () => {
  S.reset();
  const plain = await S.request('GET', '/api/defaults', { person: 'nonowner@example.com' });
  assert.equal(plain.status, 200, plain.text);
  assert.ok(!Object.hasOwn(plain.data, 'installerDataCatalogs'), plain.text);
  S.state.managers = ['boss@example.com'];
  const manager = await S.request('GET', '/api/defaults', { person: 'boss@example.com' });
  assert.ok(Object.hasOwn(manager.data, 'installerDataCatalogs'), 'a manager still gets them');
});
