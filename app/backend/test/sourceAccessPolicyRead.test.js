const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceAccess } = require('../lib/sourceAccess');

const TABLE = 'inspire_kinds.airline_e2e_rc4.pax_profile';
const PERSON = 'person-tok';
const APP = 'app-tok';
const READ_METADATA_403 = JSON.stringify({ error_code: 'PERMISSION_DENIED',
  message: "Principal 'Test Person' does not have READ METADATA on Table 'inspire_kinds.airline_e2e_rc4.pax_profile'." });

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

function harness({ person = reply(200, {}), app = reply(200, {}), personError = null, appError = null } = {}) {
  const warnings = [];
  const logger = { warn: (line) => warnings.push(String(line)) };
  const calls = [];
  const dbFetch = async (host, token, path) => {
    calls.push({ token, path });
    if (path.endsWith('/Me')) return reply(200, { displayName: 'Test Person', userName: 'builder@example.com' });
    if (path.includes('/policies/table/')) {
      if (token === PERSON) { if (personError) throw personError; return person; }
      if (appError) throw appError;
      return app;
    }
    throw new Error(`unexpected ${path}`);
  };
  const SA = createSourceAccess({
    executeSql: async () => [],
    sqlResultToObjects: (rows) => rows,
    dbFetch,
    appToken: async () => APP,
    logger,
  });
  const req = { dbHost: 'https://ws.example', dbToken: PERSON, dbTokenKind: 'request', headers: {} };
  return { SA, req, warnings, calls };
}

test('owner whose person token reads the policies as 200 {} is not refused', async () => {
  const { SA, req, warnings } = harness();
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.equal(out.app_unreadable, null);
  assert.deepEqual(warnings, []);
});

test('a 403 PERMISSION_DENIED naming READ METADATA refuses the person, and it still refuses', async () => {
  const { SA, req } = harness({ person: reply(403, READ_METADATA_403) });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(out.app_unreadable, 'the refusal must fire');
  assert.match(out.app_unreadable.text, /Test Person cannot read the access policies of the source table/);
});

test('a 403 that is not a privilege denial falls back to the App read and logs the status once', async () => {
  const scope403 = JSON.stringify({ error_code: 'PERMISSION_DENIED', message: 'Request is missing the required OAuth scope.' });
  const { SA, req, warnings } = harness({ person: reply(403, scope403) });
  const first = await SA.sourceAccess(req, 'wh1', [TABLE]);
  const again = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.equal(first.app_unreadable, null);
  assert.equal(again.app_unreadable, null);
  const logged = warnings.filter((w) => w.includes(TABLE) && w.includes('HTTP 403'));
  assert.equal(logged.length, 1, 'logged once per table');
  assert.match(logged[0], /missing the required OAuth scope/);
});

test('a 401 on the person read falls back to the App read and logs it', async () => {
  const { SA, req, warnings } = harness({ person: reply(401, '{"message":"Unauthorized"}') });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.equal(out.app_unreadable, null);
  assert.ok(warnings.some((w) => w.includes('HTTP 401')), 'the 401 is logged');
});

test('a network failure on the person read falls back and logs the error', async () => {
  const { SA, req, warnings } = harness({ personError: new Error('socket hang up') });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.equal(out.app_unreadable, null);
  assert.ok(warnings.some((w) => w.includes('socket hang up')));
});

test('the App read still refuses when the App cannot read the policies (unchanged rule)', async () => {
  const { SA, req, warnings } = harness({ person: reply(200, {}), app: reply(500, '{"message":"boom"}') });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(out.app_unreadable, 'App read failures still refuse');
  assert.ok(warnings.some((w) => w.includes('HTTP 500')), 'the App failure is logged');
});
