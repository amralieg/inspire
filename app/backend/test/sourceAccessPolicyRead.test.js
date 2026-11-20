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

// REQ-418: the policy read is the App's own (service principal). A person's read is never made, so a person's grants never decide it.
test('a 403 PERMISSION_DENIED naming READ METADATA on the App read refuses the build and asks for READ METADATA', async () => {
  const { SA, req } = harness({ app: reply(403, READ_METADATA_403) });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(out.app_unreadable, 'the refusal must fire');
  assert.match(out.app_unreadable.text, /cannot read the access policies of the source table/);
});

test('a 403 that is not a privilege denial on the App read refuses, and logs the status once per table', async () => {
  const scope403 = JSON.stringify({ error_code: 'PERMISSION_DENIED', message: 'Request is missing the required OAuth scope.' });
  const { SA, req, warnings } = harness({ app: reply(403, scope403) });
  const first = await SA.sourceAccess(req, 'wh1', [TABLE]);
  const again = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(first.app_unreadable);
  assert.ok(again.app_unreadable);
  const logged = warnings.filter((w) => w.includes(TABLE) && w.includes('HTTP 403'));
  assert.equal(logged.length, 2, 'each read logs its status: the App is the only reader');
  assert.match(logged[0], /missing the required OAuth scope/);
});

test('a 401 on the App read refuses and logs it', async () => {
  const { SA, req, warnings } = harness({ app: reply(401, '{"message":"Unauthorized"}') });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(out.app_unreadable);
  assert.ok(warnings.some((w) => w.includes('HTTP 401')), 'the 401 is logged');
});

test('a network failure on the App read refuses and logs the error', async () => {
  const { SA, req, warnings } = harness({ appError: new Error('socket hang up') });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(out.app_unreadable);
  assert.ok(warnings.some((w) => w.includes('socket hang up')));
});

test('a person read is never made for the policies: the App is the only reader (REQ-418)', async () => {
  const { SA, req, calls } = harness({ person: reply(403, READ_METADATA_403) });
  await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(calls.filter((c) => c.path.includes('/policies/')).every((c) => c.token === APP));
});

test('the App read still refuses when the App cannot read the policies (unchanged rule)', async () => {
  const { SA, req, warnings } = harness({ person: reply(200, {}), app: reply(500, '{"message":"boom"}') });
  const out = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.ok(out.app_unreadable, 'App read failures still refuse');
  assert.ok(warnings.some((w) => w.includes('HTTP 500')), 'the App failure is logged');
});

// REQ-418 (B7 open item): the App's policy read asks for inherited policies like the build does, so a row filter or column mask
// set on the schema or catalog decides the access the same way the build sees it.
test('the App policy read includes policies inherited from the schema and catalog, on every page', async () => {
  const { SA, req, calls } = harness({ app: reply(200, { policies: [], next_page_token: '' }) });
  await SA.sourceAccess(req, 'wh1', [TABLE]);
  const reads = calls.filter((c) => c.path.includes('/policies/table/'));
  assert.ok(reads.length >= 1, 'the App reads the policies');
  for (const c of reads) assert.match(c.path, /[?&]include_inherited=true(&|$)/, c.path);
});
