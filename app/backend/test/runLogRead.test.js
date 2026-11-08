const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const { qs, WH, ME, BOSS } = require('./support/routeSamples');

test.after(() => S.stopServer());

const LOG = '/Volumes/main/inspire/vol_root/logs/Acme_Bank/session_1001/log.log';
const path = (sid = '1001') => `/api/inspire/log?${qs({ inspire_database: S.APP_DB, warehouse_id: WH, session_id: sid })}`;

test('the person who launched a session reads its live log through the App, though the App owns the log folder', async () => {
  S.reset({ sessionLaunchers: { 1001: ME }, sessionBusiness: { 1001: 'Acme Bank' }, files: { [LOG]: 'line one\nline two\n' } });
  const got = await S.request('GET', path(), { person: ME });
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.data, { log_path: LOG, found: true, text: 'line one\nline two\n', truncated: false, size: 18 });
  const reads = S.state.calls.filter((c) => c.path.startsWith('/api/2.0/fs/files/'));
  assert.ok(reads.length >= 1 && reads.every((c) => c.token === S.APP_TOKEN), 'the log is read with the App sign-in');
});

test('the person who did not launch the session and does not manage the App cannot read its log (must-exclude)', async () => {
  S.reset({ managers: [BOSS], sessionLaunchers: { 1001: 'someone@example.com' }, sessionBusiness: { 1001: 'Acme Bank' }, files: { [LOG]: 'secret\n' } });
  const got = await S.request('GET', path(), { person: ME });
  assert.equal(got.status, 403);
  assert.doesNotMatch(got.text, /secret/);
  assert.equal(S.state.calls.filter((c) => c.path.startsWith('/api/2.0/fs/files/')).length, 0);
});

test('an App manager reads any session log', async () => {
  S.reset({ managers: [BOSS], sessionLaunchers: { 1001: 'someone@example.com' }, sessionBusiness: { 1001: 'Acme Bank' }, files: { [LOG]: 'x\n' } });
  const got = await S.request('GET', path(), { person: BOSS });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.text, 'x\n');
});

test('a long log returns only its last 512 KB, starting at a whole line', async () => {
  const line = `${'a'.repeat(99)}\n`;
  const body = `${line.repeat(6000)}LAST LINE\n`;
  S.reset({ sessionLaunchers: { 1001: ME }, sessionBusiness: { 1001: 'Acme Bank' }, files: { [LOG]: body } });
  const got = await S.request('GET', path(), { person: ME });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.truncated, true);
  assert.equal(got.data.size, Buffer.byteLength(body));
  assert.ok(Buffer.byteLength(got.data.text) <= 512 * 1024);
  assert.ok(got.data.text.endsWith('LAST LINE\n'));
  assert.ok(got.data.text.startsWith('a'.repeat(99)));
});

test('a run that has not written its log yet answers found false, and an unknown session answers 404', async () => {
  S.reset({ sessionLaunchers: { 1001: ME, 1002: ME }, sessionBusiness: { 1001: 'Acme Bank' }, files: { [LOG]: null } });
  const waiting = await S.request('GET', path(), { person: ME });
  assert.equal(waiting.status, 200, waiting.text);
  assert.deepEqual(waiting.data, { log_path: LOG, found: false, text: '', truncated: false, size: 0 });
  const unknown = await S.request('GET', path('1002'), { person: ME });
  assert.equal(unknown.status, 404);
});

test('a session id that is not a number is refused before any read', async () => {
  S.reset({ sessionLaunchers: { 1001: ME } });
  const got = await S.request('GET', `/api/inspire/log?${qs({ inspire_database: S.APP_DB, warehouse_id: WH, session_id: '1 OR 1=1' })}`, { person: ME });
  assert.ok([400, 403].includes(got.status), got.text);
  assert.equal(S.state.calls.filter((c) => /business_name FROM/.test(c.statement)).length, 0);
});
