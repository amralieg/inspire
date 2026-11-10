const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'catalog_access_cases.json'), 'utf8'));
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const APP_TOKEN = 'tok';
const PERSON_TOKEN = 'person-tok';
const DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'.";

async function call(base, route, opts = {}) {
  const resp = await fetch(base + route, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, run) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

for (const c of CASES.new_apps) {
  test(`new Apps catalog access: ${c.name}`, () => {
    const got = I.catalogAccessDecision(c.setting, CASES.catalog, c.account_users, c.person, c.below, c.inspire_manages);
    assert.equal(got.decision, c.decision);
    assert.deepEqual(got.real, c.real);
  });
}

test('the App and the installer read the same below-catalog grants and run the same GRANT', () => {
  assert.deepEqual(I.belowCatalogStatement(CASES.catalog), { sql: CASES.below_sql, parameters: null });
  assert.equal(I.newAppsCatalogGrant(CASES.catalog), CASES.grant_sql);
  assert.throws(() => I.belowCatalogStatement('ma`in'), /catalog/);
  assert.throws(() => I.belowCatalogStatement(''), /catalog/);
});

test('a decision that reports real grants names every grant and counts the ones past the shown limit', () => {
  const below = Array.from({ length: I.IMPLEMENT_REAL_GRANTS_SHOWN + 3 }, (_v, i) => ({ level: 'table', schema_name: 's', object_name: `t${i}`, privilege: 'SELECT' }));
  const got = I.catalogAccessDecision('', 'main', [], ['MANAGE'], below, false);
  assert.equal(got.decision, 'below');
  const text = I.newAppsAccessText('main', got.decision, got.real);
  assert.match(text, /and 3 more/);
  assert.doesNotMatch(text, /t12/);
});

for (const c of CASES.source_tables) {
  test(`source table read grants for the App: ${c.name}`, () => {
    const plan = I.accessPlan(c.table, c.rows, CASES.app.id);
    const offer = I.appReadGrantsOffer([c.table], [plan], CASES.app);
    assert.deepEqual(offer.grants, c.grants);
    assert.equal(offer.can_grant, c.can_grant);
    assert.deepEqual(offer.app, CASES.app);
    const text = I.appUnreadableMessage(offer);
    assert.match(text, new RegExp(`${CASES.app.name} \\(application id ${CASES.app.id}\\)`));
    assert.doesNotMatch(text, /swap/i);
    for (const sql of c.grants) assert.ok(text.includes(sql), sql);
    assert.match(text, c.can_grant ? /Use Let Inspire read these tables/ : c.grants.length ? /Ask the owner to run/ : /no missing grant/);
  });
}

const PERSON_OWNS = [
  { level: 'catalog', privilege: 'OWNER', principal: 'amr@x', mine: 'true', me: 'amr@x' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'amr@x' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
];
const PERSON_READS = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'amr@x' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'amr@x' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
  { level: 'table', privilege: 'SELECT', principal: 'amr@x', mine: 'true', me: 'amr@x' },
];

function split(personRows, { personReads = true, onGrant } = {}) {
  const live = { appReads: false };
  return {
    live,
    overrides: {
      useCase: { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
      tokenKind: 'app',
      forwardedToken: PERSON_TOKEN,
      workspace: ({ token, path: route }) => (route.includes('/scim/v2/Me')
        ? [token === APP_TOKEN ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: 'amr@x', displayName: 'Amr' }]
        : undefined),
      statements: {
        'LIMIT 0': (sql, _p, token) => {
          if (!sql.includes('`orders`')) return { rows: [] };
          if (token === APP_TOKEN && !live.appReads) throw new Error(DENIED);
          if (token !== APP_TOKEN && !personReads) throw new Error(DENIED);
          return { rows: [] };
        },
        'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? [] : personRows }),
        'GRANT ': (sql, _p, token) => {
          if (onGrant) onGrant(sql, token);
          if (token !== APP_TOKEN && sql.includes('`app-sp-id`')) live.appReads = true;
          return { rows: [] };
        },
      },
    },
  };
}

test('context splits a table only the App cannot read from a missing table and names the App with exact grants', async () => {
  const { overrides } = split(PERSON_OWNS);
  await withApp(overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.missing_tables, []);
    const offer = got.data.app_unreadable;
    assert.deepEqual(offer.tables, ['main.s.orders']);
    assert.deepEqual(offer.app, { name: 'inspire-manual', id: 'app-sp-id' });
    assert.deepEqual(offer.grants, ['GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`', 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`', 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`']);
    assert.equal(offer.can_grant, true);
    assert.match(offer.text, /builds run as the App service principal inspire-manual \(application id app-sp-id\)/);
    assert.doesNotMatch(offer.text, /swap/i);
  });
});

test('context keeps the missing-table path when the person cannot read the table either', async () => {
  const { overrides } = split(PERSON_READS, { personReads: false });
  await withApp(overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.missing_tables.map((m) => [m.table, m.reason]), [['main.s.orders', 'no read access']]);
    assert.equal(got.data.app_unreadable, null);
  });
});

test('a rerun the App cannot read refuses with the named App reason, never the swap advice', async () => {
  const BUILT = { spec_version: 2, status: 'ready', use_case_id: 'N01-U01', job_id: 77,
    spec_json: JSON.stringify({ use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } }),
    notebook_path: '/W/impl/N01-U01', asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 1, result_history: 1 } }), genie_widgets: '[]' };
  const { overrides } = split(PERSON_READS);
  await withApp({ ...overrides, history: [BUILT] }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 409, JSON.stringify(got.data));
    assert.match(got.data.error, /the build cannot read a source table: builds run as the App service principal inspire-manual/);
    assert.doesNotMatch(got.data.error.split('. Ask the owner')[0], /main\.s\.orders/);
    assert.match(got.data.error, /Ask the owner to run: GRANT USE SCHEMA ON SCHEMA `main`\.`s` TO `app-sp-id`; GRANT SELECT ON TABLE `main`\.`s`\.`orders` TO `app-sp-id`; GRANT READ METADATA ON TABLE `main`\.`s`\.`orders` TO `app-sp-id`$/);
    assert.doesNotMatch(got.data.error, /swap/i);
    assert.deepEqual(got.data.missing_tables, []);
    assert.equal(got.data.app_unreadable.can_grant, false);
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
});

test('plan and submit refuse a build the App cannot read with the named App reason, write nothing and start no job', async () => {
  const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
    outputs: { dashboard: true } };
  const body = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC };
  for (const [rows, canGrant] of [[PERSON_READS, false], [PERSON_OWNS, true]]) {
    for (const route of ['plan', 'submit']) {
      const { overrides } = split(rows);
      await withApp(overrides, async (url, made) => {
        const got = await call(url, `/api/inspire/implement/${route}`, { method: 'POST', body });
        assert.equal(got.status, 409, `${route}: ${JSON.stringify(got.data)}`);
        assert.match(got.data.error, /^the build cannot read a source table: builds run as the App service principal inspire-manual \(application id app-sp-id\)/);
        assert.match(got.data.error, canGrant ? /Use Let Inspire read these tables to run: GRANT USE SCHEMA/ : /Ask the owner to run: GRANT USE SCHEMA/);
        assert.doesNotMatch(got.data.error, /swap/i);
        assert.deepEqual(got.data.missing_tables, []);
        assert.equal(got.data.app_unreadable.can_grant, canGrant);
        assert.equal(made.jobs.length, 0, `${route} starts no job`);
        assert.equal(made.sqlCalls.some((c) => /^(INSERT|UPDATE|GRANT)/.test(String(c.sql))), false, `${route} writes and grants nothing`);
      });
    }
  }
});

test('Let Inspire read these tables grants with the person token only, re-probes and clears the refusal', async () => {
  const grants = [];
  const { overrides } = split(PERSON_OWNS, { onGrant: (sql, token) => grants.push([sql, token]) });
  await withApp(overrides, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { method: 'POST', body: { tables: ['main.s.orders'] } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const metadata = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`';
    assert.deepEqual(grants, [['GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`', PERSON_TOKEN], ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`', PERSON_TOKEN], [metadata, PERSON_TOKEN]]);
    assert.equal(got.data.granted, 3);
    assert.deepEqual(got.data.ran, ['GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`', 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`', metadata]);
    assert.deepEqual(got.data.abac_gaps, []);
    assert.deepEqual(got.data.failed, []);
    assert.equal(got.data.app_unreadable, null);
    assert.deepEqual(got.data.missing_tables, []);
    assert.ok(!made.sqlCalls.some((c) => c.sql.startsWith('GRANT') && c.token === APP_TOKEN));
  });
});

test('on a route that runs as the person, Let Inspire read these tables probes as the App, grants and the plan then passes', async () => {
  const grants = [];
  const { overrides } = split(PERSON_OWNS, { onGrant: (sql, token) => grants.push([sql, token]) });
  const asPerson = { ...overrides, dbToken: PERSON_TOKEN, tokenKind: 'person', appToken: APP_TOKEN };
  await withApp(asPerson, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { method: 'POST', body: { tables: ['main.s.orders'] } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(grants, [['GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`', PERSON_TOKEN], ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`', PERSON_TOKEN], ['GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`', PERSON_TOKEN]]);
    assert.equal(got.data.granted, 3);
    assert.equal(got.data.app_unreadable, null);
    assert.ok(made.sqlCalls.some((c) => c.sql.includes('LIMIT 0') && c.token === APP_TOKEN), 'the read probe runs as the App');
    const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
      outputs: { dashboard: true } };
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC } });
    assert.notEqual(plan.status, 409, JSON.stringify(plan.data));
    assert.doesNotMatch(JSON.stringify(plan.data), /cannot read main\.s\.orders/);
  });
});

test('Discover names its own job when the App cannot read a table', () => {
  const offer = I.appReadGrantsOffer(['main.s.orders'], [I.accessPlan('main.s.orders', PERSON_READS, 'app-sp-id')], { name: 'inspire', id: 'app-sp-id' });
  assert.match(I.appUnreadableMessage(offer, 'discover'), /^Discover cannot read a source table: Discover runs as the App service principal inspire/);
  assert.match(I.appUnreadableMessage(offer), /^the build cannot read/);
});

test('Let Inspire read these tables refuses with 403 and grants nothing when the person cannot grant', async () => {
  const grants = [];
  const { overrides } = split(PERSON_READS, { onGrant: (sql, token) => grants.push([sql, token]) });
  await withApp(overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { method: 'POST', body: { tables: ['main.s.orders'] } });
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.match(got.data.error, /Ask the owner to run/);
    assert.equal(got.data.app_unreadable.can_grant, false);
    assert.deepEqual(got.data.app_unreadable.app, { name: 'inspire-manual', id: 'app-sp-id' });
    assert.deepEqual(grants, []);
  });
});

test('grant-access needs the person sign-in and never grants with the App token', async () => {
  const grants = [];
  const { overrides } = split(PERSON_OWNS, { onGrant: (sql, token) => grants.push([sql, token]) });
  await withApp({ ...overrides, forwardedToken: '' }, async (url) => {
    for (const route of ['kind=source_tables', 'kind=new_apps&table=main.inspire.churn_out']) {
      const got = await call(url, `/api/inspire/implement/grant-access?${Q}&${route}`, { method: 'POST', body: { tables: ['main.s.orders'] } });
      assert.equal(got.status, 401, JSON.stringify(got.data));
      assert.equal(got.data.error, I.IMPLEMENT_GRANT_NO_SIGN_IN);
    }
    const bad = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=everything`, { method: 'POST', body: {} });
    assert.equal(bad.status, 400);
    assert.deepEqual(grants, []);
  });
});

test('grant-access rejects a malformed or empty table list', async () => {
  const { overrides } = split(PERSON_OWNS);
  await withApp(overrides, async (url) => {
    for (const tables of [[], ['main.s'], ['main.s.or`ders']]) {
      const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { method: 'POST', body: { tables } });
      assert.equal(got.status, 400, JSON.stringify(got.data));
    }
  });
});

function newApps(below, personRows) {
  const grants = [];
  return {
    grants,
    overrides: {
      tokenKind: 'app',
      forwardedToken: PERSON_TOKEN,
      statements: {
        'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? [] : personRows }),
        'schema_privileges': () => ({ rows: below }),
        'GRANT ': (sql, _p, token) => { grants.push([sql, token]); return { rows: [] }; },
      },
    },
  };
}

const OWNS_INSPIRE = [{ level: 'catalog', privilege: 'OWNER', principal: 'amr@x', mine: 'true', me: 'amr@x' }];

test('the new-Apps action grants USE CATALOG to account users with the person token when nothing real sits below', async () => {
  const { overrides, grants } = newApps([{ level: 'schema', schema_name: 'information_schema', object_name: 'information_schema', privilege: 'USE SCHEMA' }], OWNS_INSPIRE);
  await withApp(overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=new_apps&table=main.inspire.churn_out`, { method: 'POST', body: {} });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.decision, 'grant');
    assert.deepEqual(got.data.ran, ['GRANT USE CATALOG ON CATALOG `main` TO `account users`']);
    assert.deepEqual(grants, [['GRANT USE CATALOG ON CATALOG `main` TO `account users`', PERSON_TOKEN]]);
    assert.match(got.data.detail, /opens no data by itself/);
  });
});

test('the new-Apps action grants nothing when account users already hold a real grant below the catalog', async () => {
  const { overrides, grants } = newApps([{ level: 'table', schema_name: 'sales', object_name: 'orders', privilege: 'SELECT' }], OWNS_INSPIRE);
  await withApp(overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=new_apps&table=main.inspire.churn_out`, { method: 'POST', body: {} });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.decision, 'below');
    assert.deepEqual(got.data.real, ['SELECT on table main.sales.orders']);
    assert.deepEqual(grants, []);
  });
});

test('the new-Apps action grants nothing when the person cannot grant on the catalog', async () => {
  const { overrides, grants } = newApps([], [{ level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'amr@x' }]);
  await withApp(overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=new_apps&table=main.inspire.churn_out`, { method: 'POST', body: {} });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.decision, 'owner');
    assert.deepEqual(grants, []);
  });
});

test('the output check offers the new-Apps action only when the person can grant and the gap is USE CATALOG', async () => {
  const appRows = [{ level: 'catalog', privilege: 'OWNER', principal: 'amr@x', mine: 'false', me: 'inspire' },
    { level: 'schema', privilege: 'OWNER', principal: 'amr@x', mine: 'false', me: 'inspire' },
    { level: 'schema', privilege: 'USE_SCHEMA', principal: 'account users', mine: 'true', me: 'inspire' }];
  const route = `/api/inspire/implement/output-check?${Q}&table=main.inspire.churn_out`;
  for (const [personRows, offered] of [[OWNS_INSPIRE, true], [[{ level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'amr@x' }], false]]) {
    const { overrides } = newApps([], personRows);
    overrides.statements['system.information_schema.catalogs'] = (_sql, _p, token) => ({ rows: token === APP_TOKEN ? appRows : personRows });
    await withApp(overrides, async (url) => {
      const got = await call(url, route);
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.equal(Boolean(got.data.app.offer), offered, JSON.stringify(got.data.app));
      if (offered) assert.deepEqual(got.data.app.offer, { kind: 'new_apps', catalog: 'main', grants: ['GRANT USE CATALOG ON CATALOG `main` TO `account users`'] });
    });
  }
});

test('a new catalog or schema for the result table is made with the person sign-in, quoted, and IF NOT EXISTS', () => {
  const G = require('../../frontend/src/lib/tableName.js');
  assert.equal(G.createPlaceSql('main', 'churn_out'), 'CREATE SCHEMA IF NOT EXISTS `main`.`churn_out`');
  assert.equal(G.createPlaceSql('team-lake'), 'CREATE CATALOG IF NOT EXISTS `team-lake`');
  assert.equal(G.placeNameProblem('ok_name-1', 'schema'), '');
  for (const bad of ['', 'has space', 'semi;colon', 'back`tick', 'dot.ted']) assert.match(G.placeNameProblem(bad, 'schema'), /schema/, `refused: ${bad}`);
  assert.deepEqual(Object.keys(G.PLACE_RIGHTS), ['catalog', 'schema']);
  assert.match(G.PLACE_RIGHTS.catalog, /CREATE CATALOG/);
  assert.match(G.PLACE_RIGHTS.schema, /CREATE SCHEMA/);
});

test('create-schema runs one CREATE with the person token, refuses a bad name or no sign-in, and passes the workspace refusal back', async () => {
  await withApp({ forwardedToken: PERSON_TOKEN }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body: { catalog: 'main', schema: 'churn_out' } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data, { catalog: 'main', schema: 'churn_out' });
    const made1 = made.sqlCalls.filter((c) => /^CREATE /.test(c.sql));
    assert.deepEqual(made1.map((c) => [c.sql, c.token]), [['CREATE SCHEMA IF NOT EXISTS `main`.`churn_out`', PERSON_TOKEN]]);
    const cat = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body: { catalog: 'team_lake' } });
    assert.equal(cat.status, 200);
    assert.equal(made.sqlCalls.at(-1).sql, 'CREATE CATALOG IF NOT EXISTS `team_lake`');
    const bad = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body: { catalog: 'main', schema: 'x`; DROP TABLE t; --' } });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /schema name can only use letters, digits, _ and -/);
    assert.equal(made.sqlCalls.some((c) => /DROP/.test(c.sql)), false, 'a bad name runs nothing (must-exclude)');
  });
  await withApp({ forwardedToken: '', tokenKind: 'app' }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body: { catalog: 'main', schema: 'churn_out' } });
    assert.equal(got.status, 401, JSON.stringify(got.data));
    assert.equal(made.sqlCalls.some((c) => /^CREATE /.test(c.sql)), false, 'never creates with the App token (must-exclude)');
  });
  await withApp({ forwardedToken: PERSON_TOKEN, sqlErrors: { 'CREATE SCHEMA': '[PERMISSION_DENIED] User does not have CREATE SCHEMA on Catalog main' } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body: { catalog: 'main', schema: 'churn_out' } });
    assert.ok(got.status >= 400, JSON.stringify(got.data));
    assert.match(got.data.error, /CREATE SCHEMA/);
  });
});

test('Let Inspire read these tables grants every App read grant on a source only when the person can manage it, and names the owner otherwise (349060d3)', async () => {
  const grants = [];
  const { live, overrides } = split(PERSON_READS, { onGrant: (sql, token) => grants.push([sql, token]) });
  live.appReads = true;
  await withApp(overrides, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { method: 'POST', body: { tables: ['main.s.orders'] } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(grants, [], 'a person who cannot manage the table grants nothing');
    assert.equal(got.data.granted, 0);
    assert.deepEqual(got.data.abac_gaps, [{ table: 'main.s.orders', owner: 'data-eng',
      grants: ['GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`', 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`',
        'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`'] }]);
  });
});

test('the preflight context offers the App read grants when only the policy read is denied, with READ METADATA and no SELECT gap', async () => {
  const { live, overrides } = split(PERSON_OWNS);
  live.appReads = true;
  await withApp({ ...overrides, abacUnreadable: true }, async (url) => {
    const before = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.deepEqual(before.data.app_unreadable.tables, ['main.s.orders']);
    assert.equal(before.data.app_unreadable.can_grant, true);
    assert.deepEqual(before.data.app_unreadable.grants, ['GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`',
      'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`', 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`']);
  });
});

test('a built-in sample catalog the App cannot read is named as not shareable and offers no grant (copy the table instead)', async () => {
  const grants = [];
  const { live, overrides } = split(PERSON_OWNS, { onGrant: (sql, token) => grants.push([sql, token]) });
  live.appReads = true;
  await withApp({ ...overrides, abacUnreadable: true }, async (url) => {
    const got = await call(url, `/api/inspire/implement/grant-access?${Q}&kind=source_tables`, { method: 'POST',
      body: { tables: ['samples.bakehouse.sales_transactions'] } });
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.match(got.data.error, /built-in sample catalog that Databricks owns/);
    assert.match(got.data.error, /CREATE TABLE \.\.\. AS SELECT/);
    assert.deepEqual(grants, [], 'nothing is granted on a system catalog');
  });
});

test('context and preflight give the same source verdict for a readable table, an unreadable policy read, and a built-in sample (one shared function)', async () => {
  const verdict = async (overrides) => {
    let out = null;
    await withApp(overrides, async (url) => {
      const context = await call(url, `/api/inspire/implement/context?${Q}`);
      const preflight = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`);
      out = { context: !context.data.app_unreadable, preflight: preflight.data.checks && preflight.data.checks.sources ? preflight.data.checks.sources.ok : null };
    });
    return out;
  };
  const readable = split(PERSON_OWNS);
  readable.live.appReads = true;
  assert.deepEqual(await verdict(readable.overrides), { context: true, preflight: true }, 'a readable table passes both');
  const unreadable = split(PERSON_OWNS);
  unreadable.live.appReads = true;
  assert.deepEqual(await verdict({ ...unreadable.overrides, abacUnreadable: true }), { context: false, preflight: false }, 'an unreadable policy read refuses both');
  const sample = split(PERSON_OWNS);
  sample.live.appReads = true;
  const samples = { ...sample.overrides, abacUnreadable: true, useCase: { ...sample.overrides.useCase, primary_table: 'samples.bakehouse.sales_transactions', tables_involved: 'samples.bakehouse.sales_transactions' } };
  assert.deepEqual(await verdict(samples), { context: false, preflight: false }, 'a built-in sample refuses both, so the build button cannot pass where context refuses');
});

const OUT_TABLE = 'main.inspire.churn_out';
const outputVerdictOverrides = (unreadable) => {
  const { live, overrides } = split(PERSON_OWNS);
  const statements = {
    ...overrides.statements,
    'LIMIT 0': (sql, _p, token) => {
      const denied = unreadable.find((t) => sql.includes(`\`${t.split('.')[2]}\``));
      if (token === APP_TOKEN && denied) throw new Error(DENIED.replace('main.s.orders', denied));
      return { rows: [] };
    },
  };
  return { overrides: { ...overrides, statements, useCase: { ...overrides.useCase, tables_involved: `main.s.orders, ${OUT_TABLE}` } }, live };
};

test('a build output table is never checked as a source: the preflight names no result table even when the App cannot read it, and the sentence names no catalog.schema id', async () => {
  const { overrides } = outputVerdictOverrides(['main.s.orders', OUT_TABLE]);
  await withApp(overrides, async (url) => {
    const preflight = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=${OUT_TABLE}`);
    assert.equal(preflight.status, 200, JSON.stringify(preflight.data));
    assert.doesNotMatch(JSON.stringify(preflight.data.checks.sources), /churn_out/, 'the output table is not a source');
    assert.equal(preflight.data.checks.sources.ok, false, 'the real source the App cannot read still refuses');
    assert.match(preflight.data.checks.sources.detail, /^the build cannot read a source table: /);
    assert.doesNotMatch(preflight.data.checks.sources.detail.split('Ask the owner')[0], /main\.s\.orders/);
  });
});

test('an output table the App cannot read blocks nothing when every real source is readable', async () => {
  const { overrides } = outputVerdictOverrides([OUT_TABLE]);
  await withApp(overrides, async (url) => {
    const context = await call(url, `/api/inspire/implement/context?${Q}&result_table=${OUT_TABLE}`);
    assert.equal(context.data.app_unreadable, null, 'context names no unreadable output');
    const preflight = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=${OUT_TABLE}`);
    assert.equal(preflight.data.checks.sources.ok, true);
    assert.doesNotMatch(preflight.data.checks.sources.detail, /churn_out/);
  });
});
