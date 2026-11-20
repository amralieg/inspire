// REQ-418 / D-SL-10B: every data read, check and launch runs as the App's service principal. A person's own grants never decide what
// Inspire reads, and a built App's row filters and column masks are the only reason to ask the per-user identity choice.
const test = require('node:test');
const assert = require('node:assert/strict');
const RP = require('../lib/routePolicy');
const U = require('../lib/ucReads');
const I = require('../lib/inspireImplement');
const { createSourceAccess } = require('../lib/sourceAccess');
const { tokenFor } = require('../server');

const SP = 'sp-token';
const PERSON = 'person-token';
const TABLE = 'main.sales.orders';

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body };
}

// A workspace where only the App's service principal can read the table; the person gets 403 on every read.
function workspace({ policy = {} } = {}) {
  const calls = [];
  const dbFetch = async (host, token, path) => {
    calls.push({ token, path });
    if (path.includes('/policies/table/')) return token === SP ? reply(200, policy) : reply(403, { error_code: 'PERMISSION_DENIED', message: "User does not have READ METADATA on Table 'main.sales.orders'." });
    if (path.includes('/unity-catalog/tables/')) return token === SP ? reply(200, { full_name: TABLE }) : reply(403, { error_code: 'PERMISSION_DENIED', message: "User does not have SELECT on Table 'main.sales.orders'." });
    if (path.endsWith('/Me')) return reply(200, { userName: 'builder@example.com', displayName: 'Builder' });
    return reply(404, {});
  };
  return { dbFetch, calls };
}

test('a person with no grants on a source can run the read check when the App service principal can read it (fail before: the person token refused the run)', async () => {
  const { dbFetch } = workspace();
  // The request carries the App's token (identity app), and no forwarded person header: the person has no grant and no sign-in to read with.
  const req = { dbHost: 'https://ws.example', dbToken: SP, dbTokenKind: 'app', headers: {} };
  const reads = await U.runReadPlan(dbFetch, req, { tables: [TABLE] });
  assert.equal(reads.refusal, null, JSON.stringify(reads.refusal));
  assert.deepEqual(reads.skipped, []);
});

test('the App service principal decides what a run reads, not the person (every read carries the App token)', async () => {
  const { dbFetch, calls } = workspace();
  const req = { dbHost: 'https://ws.example', dbToken: SP, dbTokenKind: 'app', headers: { 'x-forwarded-access-token': PERSON } };
  await U.runReadPlan(dbFetch, req, { tables: [TABLE] });
  assert.ok(calls.length > 0);
  assert.deepEqual([...new Set(calls.map((c) => c.token))], [SP]);
});

test('a source with a row filter is reported as policied, and one without is not', async () => {
  const withFilter = workspace({ policy: { policies: [{ policy_type: 'POLICY_TYPE_ROW_FILTER', row_filter: { function_name: 'main.sales.region_filter' } }] } });
  const SA = createSourceAccess({ executeSql: async () => [], sqlResultToObjects: (rows) => rows, dbFetch: withFilter.dbFetch,
    appToken: async () => SP, logger: { warn: () => {} } });
  const req = { dbHost: 'https://ws.example', dbToken: SP, dbTokenKind: 'app', headers: {} };
  const filtered = await SA.sourceAccess(req, 'wh1', [TABLE]);
  assert.deepEqual(filtered.policied, [TABLE]);

  const open = workspace({ policy: {} });
  const plain = createSourceAccess({ executeSql: async () => [], sqlResultToObjects: (rows) => rows, dbFetch: open.dbFetch,
    appToken: async () => SP, logger: { warn: () => {} } });
  const unfiltered = await plain.sourceAccess(req, 'wh1', [TABLE]);
  assert.deepEqual(unfiltered.policied, []);
  assert.equal(unfiltered.app_unreadable, null);
});

test('the policy read of a source runs with the App token, never the person token (one detector: the same read REQ-417 uses)', async () => {
  const { dbFetch, calls } = workspace({ policy: { policies: [{ policy_type: 'POLICY_TYPE_COLUMN_MASK', column_mask: { function_name: 'main.sales.mask_fn' } }] } });
  const SA = createSourceAccess({ executeSql: async () => [], sqlResultToObjects: (rows) => rows, dbFetch, appToken: async () => SP,
    logger: { warn: () => {} } });
  const req = { dbHost: 'https://ws.example', dbToken: SP, dbTokenKind: 'app', headers: { 'x-forwarded-access-token': PERSON } };
  await SA.sourceAccess(req, 'wh1', [TABLE]);
  const policyCalls = calls.filter((c) => c.path.includes('/policies/table/'));
  assert.ok(policyCalls.length > 0);
  assert.deepEqual([...new Set(policyCalls.map((c) => c.token))], [SP]);
});

test('data routes are the App identity, and only who-did-what routes keep the person token (fail before: catalogs and run check used the person)', () => {
  for (const key of ['GET /api/catalogs', 'GET /api/tables/:catalog/:schema', 'POST /api/run/check', 'POST /api/output-folder/check',
    'POST /api/inspire/implement/preflight', 'POST /api/money/rate-sample']) {
    assert.equal(RP.identityFor(key), 'app', key);
  }
  for (const key of ['POST /api/access-request', 'POST /api/access-request/check', 'POST /api/inspire/implement/grant-access']) {
    assert.equal(RP.identityFor(key), 'person', key);
  }
});

test('the App uses its service principal token in production even when the browser sends a PAT or Bearer token (fail before: the PAT was used)', () => {
  const app = { production: true, serviceToken: '', spCredentials: true, spTokenFresh: true, spTokenCached: SP };
  const req = { headers: { 'x-db-pat-token': 'pasted-pat', authorization: 'Bearer pasted-bearer' } };
  assert.equal(tokenFor(req, app), SP);
});

test('a build job is created and started with the App token: no run-as flag, no installed job id (REQ-418 retires run-as-me)', () => {
  const params = I.implementJobParams({ '00_business_name': 'x' }, 'N01-U01', 3, 'client-1');
  assert.equal(Object.prototype.hasOwnProperty.call(params, 'inspire_run_as_person'), false);
  assert.equal(params.inspire_app_client_id, 'client-1');
});
