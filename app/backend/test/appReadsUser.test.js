const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { buildDiagnostics } = require('../lib/buildDiagnostics');
const { makeApp, listen } = require('./support/implementApp');

// A user-authorization App reads each Data Filters view as the people and groups it is shared with. These checks
// cover the route the Build page calls (Check again) for a user-authorization App.
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const PERSON_TOKEN = 'person-tok';
const VIEW = 'main.s.orders_scope';
const OWNER = 'data-eng';
const ME = 'amr@x';
const NEW = 'new.viewer@x';
const SHARED_LATER = 'later.viewer@x';
const SP = 'app-sp-2';

const acl = (people) => ({ access_control_list: people.map((p) => ({ user_name: p, all_permissions: [{ permission_level: 'CAN_USE' }] }))
  .concat([{ user_name: ME, all_permissions: [{ permission_level: 'IS_OWNER' }] }, { service_principal_name: 'app-sp', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }]) });

// The build persists the App's own objects (its Data Filters views) and how they are read; no grant is stored with them.
function userBuild(views = [VIEW]) {
  return {
    session_id: 42, use_case_id: 'N01-U01', spec_version: 3, status: 'ready_with_warnings', app_name: 'riverside-assets',
    spec_json: JSON.stringify({ use_case_id: 'N01-U01', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { app: true } }),
    asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 3, views, access_mode: 'user' } }),
  };
}

// Rows of the access catalogue: the owner holds the objects, each principal holds what the grants gave it.
function workspace({ held = {}, denied = [], people }) {
  const grants = [];
  // The access query returns every principal's privileges on the objects, so each grant the build ran shows up here.
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: ME },
    { level: 'schema', privilege: 'OWNER', principal: OWNER, mine: 'false', me: ME },
    { level: 'table', privilege: 'OWNER', principal: OWNER, mine: 'false', me: ME },
    { level: 'schema', privilege: 'MANAGE', principal: ME, mine: 'true', me: ME },
    ...Object.entries(held).flatMap(([principal, privileges]) => privileges.map((privilege) => ({
      level: privilege === 'USE CATALOG' ? 'catalog' : privilege === 'USE SCHEMA' ? 'schema' : 'table', privilege, principal, mine: 'false', me: ME }))),
  ];
  return {
    grants,
    overrides: {
      useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: VIEW, tables_involved: VIEW },
      tokenKind: 'app',
      forwardedToken: PERSON_TOKEN,
      history: [userBuild()],
      statements: {
        'system.information_schema.catalogs': () => ({ rows: rows() }),
        'GRANT ': (sql, _p, token) => {
          grants.push([sql, token]);
          if (denied.some((d) => sql.includes(d))) throw new Error('[PERMISSION_DENIED] User does not have MANAGE');
          const m = /^GRANT (USE CATALOG|USE SCHEMA|SELECT|READ METADATA) ON \w+ .+ TO `([^`]+)`$/.exec(sql);
          if (m) (held[m[2]] = held[m[2]] || []).push(m[1]);
          return { rows: [] };
        },
      },
      responses: { 'GET /api/2.0/permissions/apps/riverside-assets': [acl(people), 200] },
    },
  };
}

async function call(base, route, body) {
  const resp = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, run) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try { await run(srv.url, made); } finally { await srv.close(); }
}

test('a user-authorization App record names only its scope views, and the audience is read live: people and groups at CAN_USE or higher, never a service principal', () => {
  const row = { status: 'ready_with_warnings', app_name: 'riverside-assets', asset_status: JSON.parse(userBuild().asset_status) };
  const record = I.appReadsRecord([row]);
  assert.deepEqual(record, { row, app: '', app_name: 'riverside-assets', mode: 'user', objects: true, views: [VIEW], sources: [], tables: [{ table: VIEW, owner: '', grants: [] }] });
  const audience = I.appAudience({ access_control_list: [
    { user_name: 'a@x', all_permissions: [{ permission_level: 'CAN_VIEW' }] },
    { user_name: 'b@x', all_permissions: [{ permission_level: 'CAN_USE' }] },
    { group_name: 'admins', all_permissions: [{ permission_level: 'IS_OWNER' }] },
    { service_principal_name: 'sp-1', all_permissions: [{ permission_level: 'CAN_MANAGE' }] },
  ] });
  assert.deepEqual(audience, [{ type: 'user', name: 'b@x' }, { type: 'group', name: 'admins' }]);
});

test('Check again grants a viewer shared after the build, with the person token, and lists nothing for the App service principal', async () => {
  const w = workspace({ people: [NEW, SHARED_LATER] });
  await withApp(w.overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const toNew = w.grants.filter(([sql]) => sql.endsWith(`TO \`${NEW}\``)).map(([sql]) => sql);
    assert.deepEqual(toNew, [`GRANT USE CATALOG ON CATALOG \`main\` TO \`${NEW}\``, `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${NEW}\``,
      `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${NEW}\``, `GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${NEW}\``]);
    assert.ok(w.grants.every(([, token]) => token === PERSON_TOKEN), 'every grant runs with the person token');
    assert.ok(!w.grants.some(([sql]) => sql.includes('app-sp')), 'no grant names the App service principal');
    assert.equal(got.data.state, 'readable');
  });
});

test('a grant the person cannot run becomes a Permission Required entry with its exact SQL for that viewer', async () => {
  const w = workspace({ people: [NEW], denied: [`TO \`${NEW}\``] });
  await withApp(w.overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.state, 'unreadable');
    const [entry] = got.data.permissions;
    assert.equal(entry.principal, NEW);
    assert.ok(entry.statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${NEW}\``), JSON.stringify(entry));
    assert.match(entry.why, /opens the App riverside-assets/);
  });
});

test('a check with no grant lists what the viewer still needs and never runs a grant', async () => {
  const w = workspace({ people: [NEW] });
  await withApp(w.overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, {});
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(w.grants.length, 0, 'a check never grants');
    assert.ok(got.data.tables.some((t) => t.grants.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${NEW}\``)));
  });
});

test('the Build page diagnostics do not list the grants record as a build part', () => {
  const latest = { status: 'ready', asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 1 }, grants: { app: {} }, permissions: [] }) };
  const got = buildDiagnostics({ latest, history: [latest], steps: [], feed: [], runs: null, app_status: null }, { host: 'https://x.example.com', useCaseId: 'N01-U01', stamp: {} });
  assert.match(got.text, /Parts \(1\)/);
  assert.doesNotMatch(got.text, /Grants: no state|grants: no state/);
  assert.doesNotMatch(got.text, /Permissions: no state|permissions: no state/);
});

// The statements the build gives a principal on an App object are the same ones the backend offers: both sides read
// test/fixtures/scope_grant_cases.json, which the Python suite reads too.
test('the backend offers exactly the grants the notebook builds for an App object, from the shared fixture', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scope_grant_cases.json'), 'utf8')).cases;
  assert.ok(cases.length >= 3);
  for (const c of cases) assert.deepEqual(I.scopeGrantStatements(c.view, c.principal), c.statements, `${c.view} for ${c.principal}`);
});

test('a service-principal App with objects is checked and granted for its live service principal, with the person token', async () => {
  const SP_BUILD = { ...userBuild(), asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 3, views: [VIEW], access_mode: 'sp' } }) };
  const w = workspace({ people: [] });
  w.overrides.history = [SP_BUILD];
  w.overrides.me = { applicationId: SP, userName: SP };
  w.overrides.builtAppSp = SP;
  await withApp(w.overrides, async (url) => {
    const checked = await call(url, `/api/inspire/implement/app-reads?${Q}`, {});
    assert.equal(checked.status, 200, JSON.stringify(checked.data));
    assert.equal(checked.data.objects, true);
    assert.deepEqual(checked.data.principals, [SP], 'the live service principal is the principal');
    assert.ok(checked.data.tables.some((t) => t.grants.includes(`GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${SP}\``)));
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(w.grants.length > 0 && w.grants.every(([sql, token]) => sql.endsWith(`TO \`${SP}\``) && token === PERSON_TOKEN));
  });
});

// An object the App reads directly as a source is checked by both paths (the App-reads check and the source check) with the same
// needs list and the same statement function, so the two can never offer different grants for one object and principal.
test('a source table the App reads directly gets the same grants from the App-reads check as from the source check, held or not', () => {
  const SRC = 'main.s.orders';
  const record = I.appReadsRecord([{ status: 'ready', app_name: 'riverside-assets', asset_status: { app: { views: [VIEW], sources_read: [SRC], access_mode: 'sp' } } }]);
  assert.deepEqual(record.tables.map((t) => t.table), [VIEW, SRC], 'the App reads its view and its source table');
  for (const held of [[], ['SELECT']]) {
    const rows = held.map((privilege) => ({ level: 'table', privilege, principal: SP, mine: 'false', me: ME }));
    const offered = I.appReadsLeftFor(record, [SP], [[], rows]).filter((t) => t.table === SRC).flatMap((t) => t.grants).sort();
    const plan = I.accessPlan(SRC, rows, SP, { needs: I.IMPLEMENT_SOURCE_NEEDS });
    const sourceCheck = [...plan.grants, ...plan.gaps].map((g) => I.grantSql(g, SP)).sort();
    assert.deepEqual(offered, sourceCheck, `held: ${held.join(',') || 'nothing'}`);
    assert.ok(offered.length > 0 || held.length, 'there is something to offer when nothing is held');
  }
});

// Boundary (9A): a user-authorization App's audience is granted only the App-owned views. A source table the App reads directly is
// never granted to a person or a group: it becomes a rebuild state. A service-principal App still gets its live grants.
const SRC = 'main.s.orders';
const READERS = 'readers';

function boundaryBuild(sources = [SRC]) {
  return { ...userBuild(), asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 3, views: [VIEW], sources_read: sources, access_mode: 'user' } }) };
}

function boundaryWorkspace(people) {
  const w = workspace({ people });
  w.overrides.history = [boundaryBuild()];
  w.overrides.responses['GET /api/2.0/permissions/apps/riverside-assets'][0].access_control_list.push(
    { group_name: READERS, all_permissions: [{ permission_level: 'CAN_USE' }] });
  return w;
}

test('a user and a group in the audience are granted the App view only, never the source table it reads directly (9A boundary)', async () => {
  const w = boundaryWorkspace([NEW]);
  await withApp(w.overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const granted = w.grants.map(([sql]) => sql);
    assert.ok(granted.some((sql) => sql === `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${NEW}\``), 'the user gets the view');
    assert.ok(granted.some((sql) => sql === `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${READERS}\``), 'the group gets the view');
    assert.ok(!granted.some((sql) => /`orders`/.test(sql)), `no raw source grant: ${granted.filter((s) => /\`orders\`/.test(s)).join(' | ')}`);
    assert.ok(got.data.permissions.some((p) => p.instructions.join(' ').includes(SRC) && p.statements.length === 0),
      'the source the App reads directly is a rebuild state, not a grant');
  });
});

test('a viewer shared after the build is granted the view on Check again, and the source table stays unreadable to them', async () => {
  const w = boundaryWorkspace([NEW]);
  await withApp(w.overrides, async (url) => {
    w.overrides.responses['GET /api/2.0/permissions/apps/riverside-assets'][0].access_control_list.push(
      { user_name: SHARED_LATER, all_permissions: [{ permission_level: 'CAN_USE' }] });
    const checked = await call(url, `/api/inspire/implement/app-reads?${Q}`, {});
    assert.equal(checked.status, 200, JSON.stringify(checked.data));
    assert.ok(checked.data.principals.includes(SHARED_LATER), 'the viewer shared later is in the audience');
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(w.grants.some(([sql]) => sql === `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${SHARED_LATER}\``), 'the later viewer gets the view');
    assert.ok(!w.grants.some(([sql]) => /`orders`/.test(sql) && sql.includes(SHARED_LATER)), 'the later viewer gets no raw source grant');
  });
});
