const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/busyRetry');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const reply = (status, retryAfter) => ({ status, headers: { get: (name) => (name === 'retry-after' ? retryAfter : null) } });

test('a 429 is asked again with Retry-After first, then exponential backoff with jitter, up to the attempt limit', async () => {
  const waits = [];
  const queue = [reply(429, '3'), reply(429, null), reply(200, null)];
  const got = await B.withBusyRetry(async () => queue.shift(), { method: 'POST', sleep: async (ms) => waits.push(ms) });
  assert.equal(got.status, 200);
  assert.equal(waits[0], 3000);
  assert.ok(waits[1] >= 2 * B.BUSY_BASE_MS && waits[1] <= 2.5 * B.BUSY_BASE_MS, String(waits[1]));
  let calls = 0;
  const last = await B.withBusyRetry(async () => { calls += 1; return reply(429, '0'); }, { sleep: async () => {} });
  assert.deepEqual([last.status, calls], [429, B.BUSY_ATTEMPTS]);
});

test('a 503 is asked again only for a read, and an error that is not busy is returned at once (must-exclude)', async () => {
  for (const [method, status, expected] of [['GET', 503, 2], ['POST', 503, 1], ['GET', 500, 1], ['GET', 403, 1], ['POST', 429, 2]]) {
    let calls = 0;
    await B.withBusyRetry(async () => { calls += 1; return calls === 1 ? reply(status, '0') : reply(200, null); }, { method, sleep: async () => {} });
    assert.equal(calls, expected, `${method} ${status}`);
  }
  assert.equal(B.busyDelayMs(1, '999'), B.BUSY_MAX_MS);
  assert.equal(B.busyDelayMs(9, '', () => 1), B.BUSY_MAX_MS);
  const aborted = new AbortController();
  aborted.abort();
  let calls = 0;
  await B.withBusyRetry(async () => { calls += 1; return reply(429, '0'); }, { signal: aborted.signal, sleep: async () => {} });
  assert.equal(calls, 1, 'a cancelled request is not asked again');
});

test('every workspace call the App makes waits out a 429 instead of failing the request', async () => {
  let refused = 0;
  const workspace = await fakeWorkspace((call) => {
    if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp', expires_in: 3600 }];
    if (call.path.startsWith('/api/2.1/unity-catalog/catalogs')) {
      if (refused === 0) {
        refused += 1;
        return [429, { error_code: 'REQUEST_LIMIT_EXCEEDED', message: 'rate limited' }, { 'Retry-After': '0' }];
      }
      return [200, { catalogs: [{ name: 'main' }] }];
    }
    return null;
  });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, DATABRICKS_TOKEN: 'dev' });
    const resp = await fetch(`${inspire.url}/api/catalogs`);
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.deepEqual(data.catalogs.map((c) => c.name), ['main']);
    assert.equal(workspace.calls.filter((c) => c.path.startsWith('/api/2.1/unity-catalog/catalogs')).length, 2);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
});
