// REQ-522 (backend): a run reads as the App's service principal, so a run source needs both the signed-in person's read and the App's.
// Every picker row carries inspire_readable (true|false|null) beside REQ-521's readable, and Request Access asks, per object, for each
// principal that is missing it: the person as requester and the App through behalf_of, in one batched Request for Access.
// Spec: ~/claude/inspire/briefs/req522_spec.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const SP_ID = '11111111-2222-4333-8444-555555555555';
const SP_SCIM = 'sp-scim-42';
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: SP_ID, DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh' };
const UC = '/api/2.1/unity-catalog';
const RFA_REQUESTS = '/api/3.0/rfa/requests';
const NO_APP_PRINCIPAL = 'Inspire could not find its own account in this workspace, so ask the data owner to run the grant below';
const BAD_NEED = 'Each object can ask access only for you, for Inspire, or for both.';

const READ = ['USE_CATALOG', 'USE_SCHEMA', 'SELECT', 'READ_METADATA'];
const BIG = Array.from({ length: 105 }, (_, i) => ({ name: `s${String(i).padStart(3, '0')}`, full_name: `big.s${String(i).padStart(3, '0')}` }));
// Person: reads main, ops, dim, big; may only browse hr and vault. App: reads main, hr, big; nothing on ops and vault; Unity Catalog
// will not say for dim (403), so its App state is unknown.
const PERSON_LISTS = {
  catalogs: { readable: [{ name: 'main' }, { name: 'ops' }, { name: 'dim' }, { name: 'big' }], browse: [{ name: 'hr', browse_only: true }, { name: 'vault', browse_only: true }] },
  'schemas:main': { readable: [{ name: 's', full_name: 'main.s' }, { name: 'noapp', full_name: 'main.noapp' }],
    browse: [{ name: 'secret', full_name: 'main.secret', browse_only: true }, { name: 'locked', full_name: 'main.locked', browse_only: true }] },
  'schemas:big': { readable: BIG, browse: [] },
  'tables:main.s': { readable: ['orders', 'noapp'], browse: ['salaries', 'vaultt'] },
};
const HELD = {
  catalog: { main: READ, hr: READ, big: READ, ops: [], vault: [] },
  schema: { 'main.s': ['USE_SCHEMA', 'SELECT'], 'main.secret': ['USE_SCHEMA', 'SELECT'], 'main.noapp': [], 'main.locked': [],
    ...Object.fromEntries(BIG.map((s) => [s.full_name, ['USE_SCHEMA', 'SELECT']])) },
};
const READS = { [PERSON]: ['orders', 'noapp'], [SP_TOKEN]: ['orders', 'salaries'] };
const DESTINATIONS = {
  'catalog/hr': 'hr-owners@example.com', 'catalog/ops': 'ops-owners@example.com', 'catalog/vault': 'vault-owners@example.com',
  'catalog/main': 'main-owners@example.com',
};
const DENIED = (name) => [400, { status: { state: 'FAILED', error: { message: `[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table '${name}'.` } } }];
const EMPTY = [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'x' }] } }, result: { data_array: [] } }];
const ucTable = (name, browse) => ({ name, full_name: `main.s.${name}`, catalog_name: 'main', schema_name: 's', table_type: 'MANAGED', columns: [], ...(browse ? { browse_only: true } : {}) });

function list(key, url) {
  const got = PERSON_LISTS[key] || { readable: [], browse: [] };
  return url.searchParams.get('include_browse') === 'true' ? [...got.readable, ...got.browse] : got.readable;
}

function answerWith({ rfa = () => [200, { responses: [] }], spResolved = true, probes = [] } = {}) {
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (url.pathname === '/api/2.0/preview/scim/v2/Me') return [200, call.token === SP_TOKEN ? { userName: SP_ID, applicationId: SP_ID } : { userName: PERSON_EMAIL }];
    if (url.pathname === '/api/2.0/preview/scim/v2/ServicePrincipals') {
      const mine = (url.searchParams.get('filter') || '') === `applicationId eq "${SP_ID}"`;
      return [200, { Resources: mine && spResolved ? [{ id: SP_SCIM, applicationId: SP_ID }] : [] }];
    }
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/')) return [200, { Resources: [] }];
    if (call.token !== SP_TOKEN && url.pathname === `${UC}/catalogs`) return [200, { catalogs: list('catalogs', url) }];
    if (call.token !== SP_TOKEN && url.pathname === `${UC}/schemas`) return [200, { schemas: list(`schemas:${url.searchParams.get('catalog_name')}`, url) }];
    if (call.token !== SP_TOKEN && url.pathname === `${UC}/tables`) {
      const key = `tables:${url.searchParams.get('catalog_name')}.${url.searchParams.get('schema_name')}`;
      const got = PERSON_LISTS[key] || { readable: [], browse: [] };
      const browse = url.searchParams.get('include_browse') === 'true';
      return [200, { tables: [...got.readable.map((n) => ucTable(n)), ...(browse ? got.browse.map((n) => ucTable(n, true)) : [])] }];
    }
    const eff = /^\/api\/2\.1\/unity-catalog\/effective-permissions\/(catalog|schema)\/([^/]+)$/.exec(url.pathname);
    if (eff) {
      const name = decodeURIComponent(eff[2]);
      const held = HELD[eff[1]][name];
      if (call.token !== SP_TOKEN || !held) return [403, { error_code: 'PERMISSION_DENIED', message: 'no' }];
      return [200, { privilege_assignments: [{ principal: SP_ID, privileges: held.map((privilege) => ({ privilege })) }] }];
    }
    if (url.pathname === '/api/2.0/sql/statements') {
      const sql = String((call.body && call.body.statement) || '');
      const probe = sql.match(/^SELECT \* FROM `main`\.`s`\.`(\w+)` LIMIT 0$/);
      if (probe) {
        probes.push([probe[1], call.token]);
        return (READS[call.token] || []).includes(probe[1]) ? EMPTY : DENIED(`main.s.${probe[1]}`);
      }
      return EMPTY;
    }
    const dest = /^\/api\/3\.0\/rfa\/destinations\/([a-z]+)\/(.+)$/.exec(url.pathname);
    if (dest) {
      const found = DESTINATIONS[`${dest[1]}/${decodeURIComponent(dest[2])}`];
      return [200, { destinations: found ? [{ destination_id: found, destination_type: 'EMAIL' }] : [] }];
    }
    if (url.pathname === RFA_REQUESTS && call.method === 'POST') return rfa(call);
    return null;
  };
}

async function withInspire(run, opts = {}) {
  const probes = [];
  const workspace = await fakeWorkspace(answerWith({ ...opts, probes }));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    await run(inspire.url, workspace, probes);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const getJson = async (url) => {
  const resp = await fetch(url, { headers: signedIn });
  return { status: resp.status, data: await resp.json() };
};
const post = async (url, body) => {
  const resp = await fetch(`${url}/api/access-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn }, body: JSON.stringify(body) });
  return { status: resp.status, data: await resp.json() };
};
const rfaPosts = (workspace) => workspace.calls.filter((c) => c.method === 'POST' && c.path === RFA_REQUESTS);
const effCalls = (workspace, type) => workspace.calls.filter((c) => c.path.startsWith(`${UC}/effective-permissions/${type}/`));
const states = (rows) => Object.fromEntries(rows.map((r) => [r.full_name || r.name, [r.readable, r.inspire_readable]]));
const asked = (request) => Object.fromEntries(request.securable_permissions.map((p) => [`${p.securable.type}:${p.securable.full_name}`, [...p.permissions].sort()]));
const CAT = ['SELECT', 'USE_CATALOG', 'USE_SCHEMA'];

// ---- 1. Four states on every row ----

test('REQ-522 must-keep: the default catalog list is the REQ-521 list, with the REQ-420 partial flag on a catalog the App cannot read', async () => {
  await withInspire(async (url) => {
    const cats = await getJson(`${url}/api/catalogs`);
    assert.equal(cats.status, 200, JSON.stringify(cats.data));
    assert.deepEqual(cats.data.catalogs.map((c) => c.name), ['big', 'dim', 'main', 'ops']);
    assert.ok(cats.data.catalogs.find((c) => c.name === 'ops').partial, 'REQ-420 partial stays');
    assert.equal(cats.data.catalogs.some((c) => c.readable === false), false, 'no unreadable row by default');
  });
});

test('REQ-522: every catalog row says whether Inspire can read it (true, false, or null when Unity Catalog will not say), read with the App token', async () => {
  await withInspire(async (url, workspace) => {
    const cats = await getJson(`${url}/api/catalogs`);
    assert.equal(cats.status, 200, JSON.stringify(cats.data));
    const byName = Object.fromEntries(cats.data.catalogs.map((c) => [c.name, c]));
    assert.ok('inspire_readable' in byName.main, `REQ-522: Not implemented: catalog rows carry no inspire_readable: ${JSON.stringify(byName.main)}`);
    assert.equal(byName.main.inspire_readable, true);
    assert.equal(byName.big.inspire_readable, true);
    assert.equal(byName.ops.inspire_readable, false, 'the install pick left ops out: Inspire needs access');
    assert.equal(byName.dim.inspire_readable, null, 'Unity Catalog would not say: unknown, not a verdict');
    assert.ok(effCalls(workspace, 'catalog').every((c) => c.token === SP_TOKEN), 'the App state is read with the App token only');
    const all = await getJson(`${url}/api/catalogs?include_unreadable=1`);
    const every = states(all.data.catalogs);
    assert.deepEqual(every.hr, [false, true], 'You need access: the person may only browse hr, the App reads it');
    assert.deepEqual(every.vault, [false, false], 'both need access');
    assert.deepEqual(every.ops, [true, false], 'Inspire needs access');
    assert.deepEqual(every.main, [true, true], 'pickable');
    assert.equal(all.data.catalogs.find((c) => c.name === 'hr').partial, undefined, 'REQ-521 must-keep: an unreadable catalog carries no partial');
  });
});

test('REQ-522: every schema row says whether Inspire can read it, from the App effective permissions, capped at 100 checks', async () => {
  await withInspire(async (url, workspace) => {
    const main = await getJson(`${url}/api/catalogs/main/schemas?include_unreadable=1`);
    assert.equal(main.status, 200, JSON.stringify(main.data));
    const every = states(main.data.schemas);
    assert.ok(main.data.schemas.every((s) => 'inspire_readable' in s), `REQ-522: Not implemented: schema rows carry no inspire_readable: ${JSON.stringify(main.data.schemas[0])}`);
    assert.deepEqual(every, { 'main.locked': [false, false], 'main.noapp': [true, false], 'main.s': [true, true], 'main.secret': [false, true] });
    assert.ok(effCalls(workspace, 'schema').every((c) => c.token === SP_TOKEN), 'App token only');
    const big = await getJson(`${url}/api/catalogs/big/schemas`);
    assert.equal(big.data.schemas.length, 105, 'nothing is hidden past the cap');
    assert.equal(effCalls(workspace, 'schema').filter((c) => c.path.includes('/schema/big.')).length <= 100, true, 'at most 100 schema checks per listing');
    assert.equal(big.data.schemas.filter((s) => s.inspire_readable === true).length, 100);
    assert.deepEqual(big.data.schemas.slice(100).map((s) => s.inspire_readable), [null, null, null, null, null], 'past the cap: unknown');
  });
});

test('REQ-522: every table row says whether Inspire can read it; a browse-only table is probed with the App token only', async () => {
  await withInspire(async (url, workspace, probes) => {
    const tables = await getJson(`${url}/api/tables/main/s?include_unreadable=1`);
    assert.equal(tables.status, 200, JSON.stringify(tables.data));
    const byName = Object.fromEntries(tables.data.tables.map((t) => [t.name, t]));
    assert.ok('inspire_readable' in byName.salaries, `REQ-522: Not implemented: table rows carry no inspire_readable: ${JSON.stringify(byName.salaries)}`);
    assert.deepEqual(states(tables.data.tables), {
      'main.s.noapp': [true, false], 'main.s.orders': [true, true], 'main.s.salaries': [false, true], 'main.s.vaultt': [false, false],
    });
    assert.equal(byName.orders.pickable, true, 'SEC-01 AT5 must-keep');
    assert.equal(byName.noapp.request, 'inspire', 'SEC-01 AT5 must-keep');
    assert.equal(probes.some(([name, token]) => ['salaries', 'vaultt'].includes(name) && token === PERSON), false, 'the person is never probed on a table they may only browse');
  });
});

// ---- 2. Request Access asks for each missing principal ----

test('REQ-522: Request Access asks for the person and for the App (behalf_of) in one batched request, one result per object per principal', async () => {
  await withInspire(async (url, workspace) => {
    const got = await post(url, { objects: [
      { type: 'CATALOG', full_name: 'hr', need: ['person'], grantee: 'someone-else@example.com' },
      { type: 'CATALOG', full_name: 'ops', need: ['inspire'], behalf_of: { id: 'evil-scim', principal_type: 'USER_PRINCIPAL' } },
      { type: 'CATALOG', full_name: 'vault', need: ['person', 'inspire'], principal: 'admins' },
      { type: 'TABLE', full_name: 'main.s.noapp', need: ['inspire'] },
    ] });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const posts = rfaPosts(workspace);
    assert.equal(posts.length, 1, 'one batched POST');
    assert.equal(posts[0].token, PERSON, 'sent with the person token (SEC-02)');
    const requests = posts[0].body.requests;
    assert.equal(requests.length, 2, `REQ-522: Not implemented: Request Access asks only for the person, never for the App: ${JSON.stringify(requests)}`);
    const mine = requests.find((r) => !r.behalf_of);
    const app = requests.find((r) => r.behalf_of);
    assert.deepEqual(app.behalf_of, { id: SP_SCIM, principal_type: 'SERVICE_PRINCIPAL' }, 'the App is named by its own SCIM id, never by anything in the body');
    assert.deepEqual(asked(mine), { 'CATALOG:hr': CAT, 'CATALOG:vault': CAT });
    assert.deepEqual(asked(app), { 'CATALOG:ops': CAT, 'CATALOG:vault': CAT, 'TABLE:main.s.noapp': ['SELECT'] });
    const scim = workspace.calls.filter((c) => c.path.startsWith('/api/2.0/preview/scim/v2/') && !c.path.startsWith('/api/2.0/preview/scim/v2/Me'));
    assert.ok(scim.every((c) => decodeURIComponent(c.path).includes(`applicationId eq "${SP_ID}"`)), `only the App is ever looked up: ${scim.map((c) => c.path)}`);
    const rows = Object.fromEntries(got.data.results.map((r) => [`${r.full_name}|${r.for}`, r]));
    assert.deepEqual(Object.keys(rows).sort(), ['hr|person', 'main.s.noapp|inspire', 'ops|inspire', 'vault|inspire', 'vault|person']);
    for (const r of Object.values(rows)) assert.equal(r.sent, true, `${r.full_name}|${r.for}`);
    assert.deepEqual(rows['vault|inspire'].destinations, ['vault-owners@example.com']);
    assert.deepEqual(rows['main.s.noapp|inspire'].destinations, ['main-owners@example.com'], 'a table inherits its catalog destination (REQ-315)');
    assert.equal(got.data.sent, true);
  });
});

test('REQ-522: need names only you or Inspire; anything else is refused with 400 before any workspace call', async () => {
  await withInspire(async (url, workspace) => {
    for (const need of [['admins@example.com'], [], 'inspire']) {
      const got = await post(url, { objects: [{ type: 'CATALOG', full_name: 'ops', need }] });
      assert.equal(got.status, 400, `REQ-522: Not implemented: need ${JSON.stringify(need)} is not refused: ${got.status} ${JSON.stringify(got.data)}`);
      assert.equal(got.data.error, BAD_NEED);
    }
    assert.equal(workspace.calls.some((c) => c.path.startsWith('/api/3.0/rfa/') || c.path.includes('/scim/v2/ServicePrincipals')), false);
  });
});

test('REQ-522: when the App account cannot be found, its rows are not sent and carry the GRANT to copy; the person rows still go', async () => {
  await withInspire(async (url, workspace) => {
    const got = await post(url, { objects: [{ type: 'CATALOG', full_name: 'hr' }, { type: 'CATALOG', full_name: 'ops', need: ['inspire'] }] });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const rows = Object.fromEntries(got.data.results.map((r) => [`${r.full_name}|${r.for}`, r]));
    assert.ok(rows['ops|inspire'], `REQ-522: Not implemented: no result for the App: ${JSON.stringify(got.data.results)}`);
    assert.equal(rows['ops|inspire'].sent, false);
    assert.equal(rows['ops|inspire'].reason, NO_APP_PRINCIPAL);
    assert.ok((rows['ops|inspire'].statements || []).some((s) => s === `GRANT SELECT ON CATALOG \`ops\` TO \`${SP_ID}\``), JSON.stringify(rows['ops|inspire']));
    assert.equal(rows['hr|person'].sent, true);
    const posts = rfaPosts(workspace);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.requests.length, 1);
    assert.equal(posts[0].body.requests[0].behalf_of, undefined);
  }, { spResolved: false });
});

test('REQ-522: a refused Request for Access marks every posted row, person and App, not sent with the Databricks words', async () => {
  const refused = () => [403, { error_code: 'PERMISSION_DENIED', message: 'Provided OAuth token does not have required scopes: unity-catalog' }];
  await withInspire(async (url) => {
    const got = await post(url, { objects: [{ type: 'CATALOG', full_name: 'vault', need: ['person', 'inspire'] }] });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.results.map((r) => r.for), ['person', 'inspire'], `REQ-522: Not implemented: no row per principal: ${JSON.stringify(got.data.results)}`);
    for (const r of got.data.results) {
      assert.equal(r.sent, false);
      assert.match(r.reason, /does not have required scopes: unity-catalog/);
    }
    assert.equal(got.data.sent, false);
  }, { rfa: refused });
});

test('REQ-522 must-keep: a REQ-521 body (no need) asks only for the person, with no behalf_of and no App lookup', async () => {
  await withInspire(async (url, workspace) => {
    const got = await post(url, { objects: [{ type: 'CATALOG', full_name: 'hr' }, { type: 'CATALOG', full_name: 'vault' }] });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const posts = rfaPosts(workspace);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.requests.length, 1);
    assert.equal(posts[0].body.requests[0].behalf_of, undefined);
    assert.deepEqual(asked(posts[0].body.requests[0]), { 'CATALOG:hr': CAT, 'CATALOG:vault': CAT });
    assert.equal(workspace.calls.some((c) => c.path.includes('/scim/v2/ServicePrincipals')), false);
    assert.deepEqual(got.data.results.map((r) => [r.full_name, r.sent]), [['hr', true], ['vault', true]]);
  });
});
