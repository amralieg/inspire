// SEC-01 AT5 (W4): the Discover picker. Expanding a schema node (GET /api/tables/:catalog/:schema) lists with the person's token and
// marks each table: pickable when the person (SELECT * FROM t LIMIT 0 with the person token, tableProbeStatement) and Inspire's SP
// (the SP probe of sourceAccess.js) can both read it; otherwise request: 'person' (BROWSE only) or request: 'inspire' (the SP cannot read).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh' };
const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const DENIED = (name) => [400, { status: { state: 'FAILED', error: { message: `[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table '${name}'.` } } }];
const EMPTY = [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'x' }] } }, result: { data_array: [] } }];

// What each identity can see (BROWSE) and read (SELECT) in main.s.
const SEES = { [PERSON]: ['browse_only', 'sp_blind', 'both'], [SP_TOKEN]: ['browse_only', 'both', 'hidden'] };
const READS = { [PERSON]: ['sp_blind', 'both'], [SP_TOKEN]: ['browse_only', 'both', 'hidden'] };
const ucTable = (name) => ({ name, full_name: `main.s.${name}`, catalog_name: 'main', schema_name: 's', table_type: 'MANAGED', owner: 'data-eng', columns: [] });

function workspace(probes) {
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    const sql = String((call.body && call.body.statement) || '');
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) {
      return [200, call.token === SP_TOKEN ? { userName: 'sp-app-id', applicationId: 'sp-app-id', displayName: 'inspire-app' } : { userName: PERSON_EMAIL }];
    }
    if (url.pathname === '/api/2.1/unity-catalog/tables') return [200, { tables: (SEES[call.token] || []).map(ucTable) }];
    const one = url.pathname.match(/^\/api\/2\.1\/unity-catalog\/tables\/(.+)$/);
    if (one) {
      const name = decodeURIComponent(one[1]).split('.').pop();
      return (SEES[call.token] || []).includes(name) ? [200, ucTable(name)] : [404, { error_code: 'TABLE_DOES_NOT_EXIST', message: 'not found' }];
    }
    if (url.pathname === '/api/2.0/sql/statements') {
      const probe = sql.match(/^SELECT \* FROM `main`\.`s`\.`(\w+)` LIMIT 0$/);
      if (probe) {
        probes.push([probe[1], call.token]);
        return (READS[call.token] || []).includes(probe[1]) ? EMPTY : DENIED(`main.s.${probe[1]}`);
      }
      if (/information_schema/.test(sql)) return EMPTY;
    }
    return null;
  };
}

async function expandSchema() {
  const probes = [];
  const ws = await fakeWorkspace(workspace(probes));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: ws.url, ...APP_ENV });
    const resp = await fetch(`${inspire.url}/api/tables/main/s`, { headers: signedIn });
    return { status: resp.status, data: await resp.json(), probes };
  } finally {
    if (inspire) await inspire.stop();
    await ws.close();
  }
}
const rowOf = (data, name) => (data.tables || []).find((t) => t.full_name === `main.s.${name}`);

test('AT5: a BROWSE-only table gives request "person", a table the SP cannot read gives request "inspire", a table both read is pickable', async () => {
  const got = await expandSchema();
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const browse = rowOf(got.data, 'browse_only');
  const blind = rowOf(got.data, 'sp_blind');
  const both = rowOf(got.data, 'both');
  assert.ok(browse && blind && both, `AT5: Not implemented: the picker does not list with the person token, so the person's tables browse_only, sp_blind and both are not all listed: ${JSON.stringify(got.data.tables)}`);
  assert.ok('pickable' in both && 'request' in browse,
    `AT5: Not implemented: table rows carry no "pickable" / "request" fields (W4 picker check): ${JSON.stringify(both)}`);
  assert.equal(browse.pickable, false, 'AT5: BROWSE-only is not pickable');
  assert.equal(browse.request, 'person', 'AT5: BROWSE-only asks access for the person');
  assert.equal(blind.pickable, false, 'AT5: a table the SP cannot read is not pickable');
  assert.equal(blind.request, 'inspire', 'AT5: the SP cannot read: request access for Inspire');
  assert.equal(both.pickable, true, 'AT5: both read: pickable');
  assert.equal(both.request, undefined, 'AT5: a pickable table asks for nothing');
});

test('AT5: the picker lists with the person token and probes reads with the person and the SP', async () => {
  const got = await expandSchema();
  assert.equal(rowOf(got.data, 'hidden'), undefined, `AT5: a table only the SP can see is listed to the person (listed with the App token): ${JSON.stringify((got.data.tables || []).map((t) => t.full_name))}`);
  const by = (token) => got.probes.filter(([, t]) => t === token).map(([n]) => n).sort();
  assert.deepEqual(by(PERSON), ['both', 'browse_only', 'sp_blind'], 'AT5: each listed table is probed with the person token');
  assert.ok(by(SP_TOKEN).includes('both') && by(SP_TOKEN).includes('sp_blind'), `AT5: the SP probe runs on the tables the person can read: ${JSON.stringify(by(SP_TOKEN))}`);
});
