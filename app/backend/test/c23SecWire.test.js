// c23 sec_wire: the c23_sec_routes fixes wired into server.js and routePolicy.js, and the launch read check over a whole large scope.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { launch } = require('./support/c23SecLaunch');
const RP = require('../lib/routePolicy');

const POLICY = RP.ROUTE_POLICY;

// 4. The three routes that write with the App's identity take the owner-or-manager rule.
for (const key of ['PUT /api/inspire/value/answers', 'POST /api/inspire/value/run-review', 'POST /api/inspire/docs/save']) {
  test(`item 4: ${key} is an owners route`, () => {
    assert.ok(POLICY[key], `${key} has a policy entry`);
    assert.equal(POLICY[key].rule, 'owners');
    // SEC-02: the answers save reads the source table the caller names for its estimate, so it stays a person route.
    assert.equal(POLICY[key].identity, key === 'PUT /api/inspire/value/answers' ? 'person' : 'app');
  });
}

// 2. The picker's partial-catalog ask names only the picked catalogs.
test('item 2: /api/catalogs?picked=b asks only for the grants catalog b misses', async () => {
  const names = ['a', 'b', 'c'];
  const workspace = await fakeWorkspace((call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: 'pat@example.com' }];
    if (url.pathname === '/api/2.1/unity-catalog/catalogs') return [200, { catalogs: names.map((name) => ({ name })) }];
    if (url.pathname.startsWith('/api/2.1/unity-catalog/effective-permissions/catalog/')) {
      return [200, { privilege_assignments: [{ principal: 'inspire-client', privileges: [{ privilege: 'USE_CATALOG' }] }] }];
    }
    return null;
  });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 's', INSPIRE_WAREHOUSE_ID: 'wh' });
    const resp = await fetch(`${inspire.url}/api/catalogs?picked=b`, { headers: { 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': 'pat@example.com' } });
    const data = await resp.json();
    const statements = (data.permissions || []).flatMap((p) => p.statements || []);
    assert.ok(statements.length > 0, JSON.stringify(data));
    assert.ok(statements.every((s) => s.includes('`b`')), `the ask names a catalog that was not picked: ${statements.join(' | ')}`);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
});

// 5. No cut scope: every table of a large scope is checked with the person's token, in batches.
const many = (n) => Array.from({ length: n }, (_, i) => `main.s.t${String(i).padStart(5, '0')}`);
const personProbes = (got) => got.calls.filter((c) => c.path === '/api/2.0/sql/statements' && c.token === 'person-token' && /LIMIT 0/.test(String(c.body && c.body.statement)));

test('item 5: a scope of 600 readable tables launches, checked in batches rather than one statement per table', async () => {
  const got = await launch({ tables: many(600), scope: 'main.s' });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.jobs.length > 0, true);
  const probes = personProbes(got);
  const covered = new Set(probes.flatMap((c) => String(c.body.statement).replace(/`/g, '').match(/main\.s\.t\d{5}/g) || []));
  assert.equal(covered.size, 600, 'every table is probed');
  assert.ok(probes.length <= 60, `${probes.length} statements for 600 tables`);
});

test('item 5: one denied table among 600 refuses the launch and names it', async () => {
  const denied = 'main.s.t00417';
  const got = await launch({ tables: many(600), scope: 'main.s', personProbe: 'denied', deniedTables: [denied] });
  assert.equal(got.status, 403, got.text);
  assert.equal(got.jobs.length, 0);
  assert.ok(got.text.includes(denied), got.text);
  assert.ok(got.live.personGets.includes(denied), 'the name was shown only after the person could list it');
});

test('item 5: a scope above the 5000-table bound is refused with "take some tables off"', async () => {
  const got = await launch({ tables: many(5001), scope: 'main.s' });
  assert.equal(got.status, 403, got.text);
  assert.equal(got.jobs.length, 0);
  assert.match(got.text, /could not check that you can read every table of this scope/);
});

test('item 5: a batch that fails for a reason that is not a denial fails closed', async () => {
  const got = await launch({ tables: many(300), scope: 'main.s', personProbe: 'warehouse' });
  assert.equal(got.status, 403, got.text);
  assert.equal(got.jobs.length, 0);
});

test('item 5 (SEC-06): a policied table among 600 still stops the launch', async () => {
  const got = await launch({ tables: many(600), scope: 'main.s', policied: ['main.s.t00250'] });
  assert.equal(got.jobs.length, 0, got.text);
  assert.equal(got.status, 403, got.text);
  assert.match(got.text, /row filter|column mask/i, got.text);
});
