// REQ-521 Part B (backend): the Start picker lists what the signed-in person can read, "Show everything" adds what they can only
// browse (marked readable:false), and one Request Access press sends one batched Request for Access for the picked objects.
// Readable vs not readable comes from Unity Catalog itself: the list APIs with `include_browse=true` also return the objects the
// person holds only BROWSE on, each with `browse_only: true` (docs: Unity Catalog REST catalogs/schemas/tables list).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const SP_ID = 'inspire-client';
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: SP_ID, DATABRICKS_CLIENT_SECRET: 'inspire-secret' };
const UC = '/api/2.1/unity-catalog';
const RFA_REQUESTS = '/api/3.0/rfa/requests';
const NO_DESTINATION = 'no one has set up where access requests for these go yet, so ask your Databricks admin to send them the copied text';

// The person reads `main` and `ops` and may only browse `hr`. The App's principal reads `main` and holds nothing on `ops`, so REQ-420
// keeps `ops` flagged partial with its missing GRANT lines.
const READABLE = {
  catalogs: [{ name: 'main' }, { name: 'ops' }],
  schemas: [{ name: 's', full_name: 'main.s' }],
  tables: [{ name: 'orders', full_name: 'main.s.orders', table_type: 'MANAGED' }],
};
const BROWSE_ONLY = {
  catalogs: [{ name: 'hr', browse_only: true }],
  schemas: [{ name: 'secret', full_name: 'main.secret', browse_only: true }],
  tables: [{ name: 'salaries', full_name: 'main.s.salaries', table_type: 'MANAGED', browse_only: true }],
};
const HELD = { main: ['USE_CATALOG', 'USE_SCHEMA', 'SELECT', 'READ_METADATA'] };
const DESTINATIONS = {
  'catalog/hr': [{ destination_id: 'hr-owners@example.com', destination_type: 'EMAIL' }],
  'schema/main.secret': [{ destination_id: 'data-team@example.com', destination_type: 'EMAIL' }],
  'schema/main.s': [{ destination_id: 'https://tickets.example.com/new', destination_type: 'URL' }],
};

function ucList(kind, url) {
  const browse = url.searchParams.get('include_browse') === 'true';
  return [200, { [kind]: [...READABLE[kind], ...(browse ? BROWSE_ONLY[kind] : [])] }];
}

function answerWith(rfa) {
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, call.token === SP_TOKEN ? { userName: SP_ID, applicationId: SP_ID } : { userName: PERSON_EMAIL }];
    if (url.pathname === `${UC}/catalogs`) return ucList('catalogs', url);
    if (url.pathname === `${UC}/schemas`) return ucList('schemas', url);
    if (url.pathname === `${UC}/tables`) return ucList('tables', url);
    const eff = /^\/api\/2\.1\/unity-catalog\/effective-permissions\/catalog\/([^/]+)$/.exec(url.pathname);
    if (eff) return [200, { privilege_assignments: [{ principal: SP_ID, privileges: (HELD[decodeURIComponent(eff[1])] || []).map((privilege) => ({ privilege })) }] }];
    const dest = /^\/api\/3\.0\/rfa\/destinations\/([a-z]+)\/(.+)$/.exec(url.pathname);
    if (dest) return [200, { destinations: DESTINATIONS[`${dest[1]}/${decodeURIComponent(dest[2])}`] || [] }];
    if (url.pathname === RFA_REQUESTS && call.method === 'POST') return rfa(call);
    return null;
  };
}

const accepted = () => [200, { responses: [] }];

async function withInspire(run, rfa = accepted) {
  const workspace = await fakeWorkspace(answerWith(rfa));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    await run(inspire.url, workspace);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const getJson = async (url, headers = signedIn) => {
  const resp = await fetch(url, { headers });
  return { status: resp.status, data: await resp.json() };
};
const post = async (url, body, headers = signedIn) => {
  const resp = await fetch(`${url}/api/access-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: resp.status, data: await resp.json() };
};
const rfaPosts = (workspace) => workspace.calls.filter((c) => c.method === 'POST' && c.path === RFA_REQUESTS);
const browseCalls = (workspace, kind) => workspace.calls.filter((c) => c.path.startsWith(`${UC}/${kind}?`) && c.path.includes('include_browse=true'));
const rows = (list) => list.map((r) => [r.full_name || r.name, r.readable]);

// ---- B1: listing ----

test('REQ-521 must-keep: by default the picker lists only what the person can read, with no unreadable row (catalogs, schemas, tables)', async () => {
  await withInspire(async (url) => {
    const cats = await getJson(`${url}/api/catalogs`);
    assert.equal(cats.status, 200, JSON.stringify(cats.data));
    assert.deepEqual(cats.data.catalogs.map((c) => c.name), ['main', 'ops'], 'the readable catalogs; browse-only `hr` is hidden');
    assert.ok(cats.data.catalogs.find((c) => c.name === 'ops').partial, 'REQ-420: a catalog the App cannot read keeps its partial flag');
    assert.equal(cats.data.catalogs.some((c) => c.readable === false), false);
    const schemas = await getJson(`${url}/api/catalogs/main/schemas`);
    assert.deepEqual(schemas.data.schemas.map((s) => s.full_name), ['main.s'], 'browse-only `main.secret` is hidden by default');
    const tables = await getJson(`${url}/api/tables/main/s`);
    assert.deepEqual(tables.data.tables.map((t) => t.full_name), ['main.s.orders'], 'browse-only `main.s.salaries` is hidden by default');
  });
});

test('REQ-521: include_unreadable=1 adds the catalogs the person may only browse, marked readable:false, listed with the person token', async () => {
  await withInspire(async (url, workspace) => {
    const cats = await getJson(`${url}/api/catalogs?include_unreadable=1`);
    assert.equal(cats.status, 200, JSON.stringify(cats.data));
    assert.ok(browseCalls(workspace, 'catalogs').length > 0, 'REQ-521: Not implemented: /api/catalogs never asks Unity Catalog for browse-only catalogs (include_browse=true)');
    assert.ok(browseCalls(workspace, 'catalogs').every((c) => c.token === PERSON), 'SEC-02: the list is read with the person token only');
    assert.deepEqual(rows(cats.data.catalogs), [['hr', false], ['main', true], ['ops', true]],
      'readable rows carry readable:true; a browse-only catalog shows as readable:false');
    const byName = Object.fromEntries(cats.data.catalogs.map((c) => [c.name, c]));
    assert.ok(byName.ops.partial, 'REQ-420 must-keep: the partial flag of a readable catalog stays');
    assert.equal(byName.hr.partial, undefined, 'an unreadable catalog carries no App GRANT lines: the person must get access first');
  });
});

test('REQ-521: include_unreadable=1 adds browse-only schemas and tables, marked readable:false', async () => {
  await withInspire(async (url, workspace) => {
    const schemas = await getJson(`${url}/api/catalogs/main/schemas?include_unreadable=1`);
    assert.equal(schemas.status, 200, JSON.stringify(schemas.data));
    assert.ok(browseCalls(workspace, 'schemas').length > 0, 'REQ-521: Not implemented: the schema list never asks for browse-only schemas');
    assert.deepEqual(rows(schemas.data.schemas), [['main.s', true], ['main.secret', false]]);
    const tables = await getJson(`${url}/api/tables/main/s?include_unreadable=1`);
    assert.equal(tables.status, 200, JSON.stringify(tables.data));
    assert.ok(browseCalls(workspace, 'tables').every((c) => c.token === PERSON), 'SEC-02: person token only');
    assert.deepEqual(rows(tables.data.tables), [['main.s.orders', true], ['main.s.salaries', false]]);
  });
});

// ---- B2: Request Access for picked objects ----

const PICKED = [
  { type: 'CATALOG', full_name: 'hr' },
  { type: 'SCHEMA', full_name: 'main.secret' },
  { type: 'TABLE', full_name: 'main.s.salaries' },
  { type: 'TABLE', full_name: 'main.x.nodest' },
];

test('REQ-521: Request Access sends one batched request for the picked objects as the person and answers per object', async () => {
  await withInspire(async (url, workspace) => {
    // A grantee in the body is ignored: the request is always the signed-in person's own.
    const got = await post(url, { objects: PICKED.map((o) => ({ ...o, grantee: 'someone-else@example.com' })) });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(Array.isArray(got.data.results), `REQ-521: Not implemented: /api/access-request takes no {objects} and answers no per-object results: ${JSON.stringify(got.data)}`);
    const posts = rfaPosts(workspace);
    assert.equal(posts.length, 1, 'one batched POST for every sendable object');
    assert.equal(posts[0].token, PERSON, 'sent with the person token (SEC-02)');
    assert.equal(posts[0].body.requests.length, 1, 'one request object: the requester');
    assert.equal(posts[0].body.requests[0].behalf_of, undefined, 'never on behalf of anyone else');
    const asked = Object.fromEntries(posts[0].body.requests[0].securable_permissions.map((p) => [`${p.securable.type}:${p.securable.full_name}`, [...p.permissions].sort()]));
    assert.deepEqual(asked, {
      'CATALOG:hr': ['SELECT', 'USE_CATALOG', 'USE_SCHEMA'],
      'SCHEMA:main.secret': ['SELECT', 'USE_SCHEMA'],
      'TABLE:main.s.salaries': ['SELECT'],
    }, 'read access only; the object with no destination is not sent');
    assert.equal(workspace.calls.some((c) => c.path.startsWith('/api/2.0/preview/scim/v2/Users')), false, 'no grantee lookup: the body grantee is ignored');
    const byName = Object.fromEntries(got.data.results.map((r) => [r.full_name, r]));
    assert.deepEqual(Object.keys(byName).sort(), PICKED.map((o) => o.full_name).sort(), 'one result per picked object');
    assert.deepEqual(byName.hr.destinations, ['hr-owners@example.com']);
    assert.deepEqual(byName['main.s.salaries'].destinations, ['https://tickets.example.com/new'], 'a table inherits its schema destination (REQ-315)');
    for (const name of ['hr', 'main.secret', 'main.s.salaries']) assert.equal(byName[name].sent, true, name);
    assert.equal(byName['main.x.nodest'].sent, false);
    assert.equal(byName['main.x.nodest'].reason, NO_DESTINATION);
    assert.equal(got.data.sent, true, 'sent is true when at least one object was sent');
  });
});

test('REQ-521: a refused Request for Access marks every object not sent with the Databricks words', async () => {
  const refused = () => [403, { error_code: 'PERMISSION_DENIED', message: 'Provided OAuth token does not have required scopes: unity-catalog' }];
  await withInspire(async (url, workspace) => {
    const got = await post(url, { objects: PICKED.slice(0, 2) });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(Array.isArray(got.data.results), `REQ-521: Not implemented: no per-object results: ${JSON.stringify(got.data)}`);
    assert.equal(rfaPosts(workspace).length, 1);
    assert.equal(got.data.sent, false);
    for (const r of got.data.results) {
      assert.equal(r.sent, false, r.full_name);
      assert.match(r.reason, /does not have required scopes: unity-catalog/, r.full_name);
    }
  }, refused);
});

test('REQ-521: more than 50 objects, an unknown type or a bad name is refused with 400 before any workspace call', async () => {
  await withInspire(async (url, workspace) => {
    const many = Array.from({ length: 51 }, (_, i) => ({ type: 'TABLE', full_name: `main.s.t${i}` }));
    const tooMany = await post(url, { objects: many });
    assert.equal(tooMany.status, 400, `REQ-521: Not implemented: 51 objects are not refused: ${tooMany.status} ${JSON.stringify(tooMany.data)}`);
    assert.equal(tooMany.data.error, 'Pick at most 50 objects per request.');
    for (const bad of [[{ type: 'WAREHOUSE', full_name: 'main' }], [{ type: 'TABLE', full_name: 'main.s' }], [{ type: 'SCHEMA', full_name: '' }]]) {
      const got = await post(url, { objects: bad });
      assert.equal(got.status, 400, `${JSON.stringify(bad)}: ${got.status} ${JSON.stringify(got.data)}`);
    }
    assert.equal(workspace.calls.some((c) => c.path.startsWith('/api/3.0/rfa/')), false, 'nothing is read or sent for a refused body');
    const fifty = await post(url, { objects: many.slice(0, 50) });
    assert.equal(fifty.status, 200, 'exactly 50 is allowed');
  });
});

test('REQ-521 must-keep: the Permission Required {statements} body and the 401 without a person token are unchanged', async () => {
  await withInspire(async (url, workspace) => {
    const anon = await post(url, { objects: PICKED.slice(0, 1) }, {});
    assert.equal(anon.status, 401, 'no person token, no request (SEC-02)');
    const got = await post(url, { statements: [`GRANT SELECT ON TABLE \`main\`.\`s\`.\`salaries\` TO \`${PERSON_EMAIL}\``] });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.sent, true, JSON.stringify(got.data));
    assert.deepEqual(got.data.destinations, ['https://tickets.example.com/new']);
    const posts = rfaPosts(workspace);
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body.requests[0].securable_permissions, [{ securable: { type: 'TABLE', full_name: 'main.s.salaries' }, permissions: ['SELECT'] }]);
  });
});
