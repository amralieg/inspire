const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../lib/inspireImplement');
const w = require('../../frontend/src/lib/implementWizard.js');
const { makeApp, listen } = require('./support/implementApp');

const SHARED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'use_case_schema_names.json'), 'utf8'));
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const PERSON_TOKEN = 'person-tok';
const OWN = 'main._inspire_acme_n01_u01.n01_u01_results';
const SCHEMA = '_inspire_acme_n01_u01';
const INSPIRE = 'main.inspire.n01_u01_s42_out';

for (const c of SHARED.cases) {
  test(`the App names the use case schema like the shared case: ${c.name}`, () => {
    assert.equal(w.defaultResultTable(c.inspire_database, c.use_case_id, c.session_id, c.business_name, { clash: c.clash }), c.table);
    assert.ok(c.table.split('.')[1].length <= 255);
  });
}

for (const c of SHARED.errors) {
  test(`the App refuses to name a use case schema without a usable session id: ${c.name}`, () => {
    assert.throws(() => w.defaultResultTable(c.inspire_database, c.use_case_id, c.session_id, c.business_name), new RegExp(c.error));
    assert.equal(w.nameOrEmpty(() => w.defaultResultTable(c.inspire_database, c.use_case_id, c.session_id, c.business_name)), '');
  });
}

test('a new use case defaults to its own schema; the Inspire database schema keeps today\'s name', () => {
  const spec = w.defaultSpecFromUseCase({ use_case_id: 'N01-U01' }, { inspireDatabase: 'main.inspire', sessionId: '42', businessName: 'Acme' });
  assert.equal(spec.config.result_table, OWN);
  assert.equal(w.inspireSchemaResultTable('main.inspire', 'N01-U01', '42'), INSPIRE);
  assert.equal(w.resultPlaceOf(OWN, OWN, INSPIRE), 'own');
  assert.equal(w.resultPlaceOf(INSPIRE.toUpperCase(), OWN, INSPIRE), 'inspire');
  assert.equal(w.resultPlaceOf('sales.mvp.churn', OWN, INSPIRE), 'pick');
  assert.equal(w.defaultSpecFromUseCase({ use_case_id: 'N01-U01' }, { inspireDatabase: 'main.inspire', businessName: 'Acme' }).config.result_table, '',
    'no session id names no table rather than guessing');
});

test('an existing build keeps its result table; the own-schema default never replaces it', () => {
  const fallback = w.defaultSpecFromUseCase({ use_case_id: 'N01-U01' }, { inspireDatabase: 'main.inspire', sessionId: '42', businessName: 'Acme' });
  const latest = { spec_version: 3, status: 'ready', spec_json: { config: { result_table: 'main.inspire.churn_out' }, outputs: {} } };
  assert.equal(w.specFromLatest(latest, fallback).config.result_table, 'main.inspire.churn_out');
});

const RIGHT = { kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' };
const ME = { kind: 'me', schema_name: '', value: 'amr@x' };
const place = (rows, extra = {}) => I.useCaseSchemaPlace({ inspireDatabase: 'main.inspire', useCaseId: 'N01-U01', sessionId: '42', businessName: 'Acme', rows, ...extra });

test('with CREATE SCHEMA on the catalog the own schema is the default and Inspire creates it', () => {
  const got = place([RIGHT, ME]);
  assert.deepEqual([got.table, got.place, got.create, got.note], [OWN, 'own', true, '']);
  assert.equal(place([{ kind: 'right', schema_name: '', value: 'ALL PRIVILEGES' }]).place, 'own');
  assert.equal(place([{ kind: 'right', schema_name: '', value: 'OWNER' }]).place, 'own');
});

test('without the right to create a schema the default switches to the Inspire database schema and names the GRANT', () => {
  for (const rows of [[ME], [{ kind: 'right', schema_name: '', value: 'USE_CATALOG' }, ME]]) {
    const got = place(rows);
    assert.deepEqual([got.table, got.place, got.create, got.own_table], [INSPIRE, 'inspire', false, OWN]);
    assert.match(got.note, /GRANT CREATE SCHEMA ON CATALOG `main` TO `amr@x`/);
  }
  const unchecked = place(null, { unchecked: 'warehouse stopped' });
  assert.equal(unchecked.table, INSPIRE);
  assert.match(unchecked.note, /could not check whether you can create schemas in main \(warehouse stopped\)/);
});

const tagged = (schema, tags) => [{ kind: 'exists', schema_name: schema, value: '' },
  ...Object.entries(tags).map(([kind, value]) => ({ kind, schema_name: schema, value }))];
const LINEAGE = { inspire_database: 'main.inspire', inspire_use_case_id: 'N01-U01' };

test('the plain name has no session digits: _inspire_<business>_<use case id>', () => {
  assert.equal(w.schemaNameOfUseCase('Airline', 'N01-U01', '1234567848213'), '_inspire_airline_n01_u01');
  assert.equal(w.schemaNameOfUseCase('Airline', 'N01-U01', '9223372036854775807'), '_inspire_airline_n01_u01', 'the session id never changes the name');
  assert.equal(I.useCaseSchemaPlace({ inspireDatabase: 'main.inspire', useCaseId: 'N01-U01', sessionId: '1234567848213', businessName: 'Airline', rows: [RIGHT] }).table,
    'main._inspire_airline_n01_u01.n01_u01_results');
});

test('an own schema that already holds this session is used as it is, without the right to create one', () => {
  const got = place(tagged(SCHEMA, { ...LINEAGE, inspire_session_id: '42' }));
  assert.deepEqual([got.table, got.place, got.create, got.note], [OWN, 'own', false, '']);
  const older = place(tagged(SCHEMA, { inspire_session_id: '42', inspire_use_case_id: 'N01-U01' }));
  assert.deepEqual([older.table, older.place, older.create], [OWN, 'own', false], 'a schema tagged before the database tag existed is ours for its own session');
});

test('a re-run in a new session of the same Inspire database reuses the schema and keeps the older session rows apart', () => {
  const got = place(tagged(SCHEMA, { ...LINEAGE, inspire_session_id: '7' }));
  assert.deepEqual([got.table, got.place, got.create], ['main._inspire_acme_n01_u01.n01_u01_results_s42', 'own', false]);
  assert.match(got.note, /_inspire_acme_n01_u01 is this use case's schema from session 7 of this Inspire database, so Inspire uses it again/);
  assert.match(got.note, /main\._inspire_acme_n01_u01\.n01_u01_results_s42 so session 7 keeps its rows/);
  const upper = place(tagged(SCHEMA, { inspire_database: 'MAIN.Inspire', inspire_use_case_id: 'n01-u01', inspire_session_id: '7' }));
  assert.equal(upper.place, 'own', 'tags compare without case');
});

test('a schema of the same name that is not this use case\'s gets the shortest free clash suffix, and the wizard says so', () => {
  const cases = [
    [tagged(SCHEMA, {}), /Inspire did not create it for this use case/],
    [tagged(SCHEMA, { inspire_database: 'other.db', inspire_use_case_id: 'N01-U01', inspire_session_id: '42' }), /it belongs to the Inspire database other\.db/],
    [tagged(SCHEMA, { inspire_database: 'main.inspire', inspire_use_case_id: 'N09-U09', inspire_session_id: '42' }), /it holds use case N09-U09/],
    [tagged(SCHEMA, { inspire_session_id: '777', inspire_use_case_id: 'N01-U01' }), /it holds session 777/],
  ];
  for (const [rows, why] of cases) {
    const got = place([...rows, RIGHT]);
    assert.deepEqual([got.table, got.place, got.create], ['main._inspire_acme_n01_u01__2.n01_u01_results', 'own', true]);
    assert.match(got.note, /^_inspire_acme_n01_u01 already exists and is not this use case's schema \(/);
    assert.match(got.note, why);
    assert.match(got.note, /so this use case's own schema is _inspire_acme_n01_u01__2\.$/);
  }
  const two = place([...tagged(SCHEMA, {}), ...tagged(`${SCHEMA}__2`, { inspire_database: 'x.y', inspire_use_case_id: 'N01-U01' }), RIGHT]);
  assert.equal(two.table, 'main._inspire_acme_n01_u01__3.n01_u01_results');
  const mine = place([...tagged(SCHEMA, {}), ...tagged(`${SCHEMA}__4`, { ...LINEAGE, inspire_session_id: '42' }), RIGHT]);
  assert.deepEqual([mine.table, mine.create], ['main._inspire_acme_n01_u01__4.n01_u01_results', false], 'the suffixed schema this lineage made earlier is reused, not a new one');
});

test('when every candidate name is taken the tables go to the Inspire database schema and the wizard names the range', () => {
  const taken = w.USE_CASE_SCHEMA_CLASH_LIMIT;
  assert.equal(taken, 9);
  const rows = [RIGHT, ...tagged(SCHEMA, {})];
  for (let n = 2; n <= taken; n += 1) rows.push(...tagged(`${SCHEMA}__${n}`, {}));
  const got = place(rows);
  assert.deepEqual([got.table, got.place, got.own_table, got.create], [INSPIRE, 'inspire', '', false]);
  assert.match(got.note, /_inspire_acme_n01_u01 through _inspire_acme_n01_u01__9 already exist and none is this use case's schema/);
});

test('the candidates are the plain name then __2 to __9, and the statement reads them all at once', () => {
  const names = I.useCaseSchemaCandidates('main.inspire', 'N01-U01', '42', 'Acme').map((t) => I.tableParts(t).schema);
  assert.deepEqual(names, [SCHEMA, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${SCHEMA}__${n}`)]);
  assert.equal(I.useCaseSchemaStatement('main', names).parameters.length, 10);
});

test('a long or non-ASCII business still names a valid Unity Catalog schema', () => {
  const long = w.schemaNameOfUseCase('Ünïcode Business '.repeat(40), 'N01-U01', '42', { clash: 9 });
  assert.ok(long.length <= 255, String(long.length));
  assert.match(long, /^[a-z0-9_]+$/);
  assert.ok(long.endsWith('_n01_u01__9'));
  assert.equal(w.schemaNameOfUseCase('شركة الطيران', 'N01-U01', '42'), '_inspire_n01_u01');
  assert.equal(w.schemaNameOfUseCase('Émirates Air', 'N01-U01', '42'), '_inspire_mirates_air_n01_u01');
});

test('the schema statement reads existence, the session tag, the person\'s catalog rights and who they are, parameterised', () => {
  const got = I.useCaseSchemaStatement('main', ['_Inspire_A', '_inspire_a']);
  assert.match(got.sql, /information_schema\.schema_tags/);
  assert.match(got.sql, /tag_name IN \('inspire_session_id', 'inspire_use_case_id', 'inspire_database'\)/);
  assert.match(got.sql, /catalog_privileges/);
  assert.deepEqual(got.parameters.map((p) => [p.name, p.value]), [['c', 'main'], ['s0', '_inspire_a']]);
  assert.equal(I.useCaseSchemaTagsSql('main', 's', { inspire_session_id: '42', inspire_use_case_id: 'N01-U01', inspire_business: "Acme's" }),
    "ALTER SCHEMA `main`.`s` SET TAGS ('inspire_session_id' = '42', 'inspire_use_case_id' = 'N01-U01', 'inspire_business' = 'Acme\\'s')");
  assert.equal(I.useCaseSchemaBuilderGrant('main', 's', 'app-sp'), 'GRANT USE SCHEMA, CREATE TABLE, CREATE MODEL, SELECT, MODIFY, MANAGE ON SCHEMA `main`.`s` TO `app-sp`');
  assert.equal(I.useCaseSchemaBuilderGrant('main', 's', 'x`y'), '');
});

test('the grant on a use case schema Inspire creates covers every right the build check asks of the identity Inspire builds as, a model-training use case included (must-exclude)', () => {
  const rowsFrom = (privileges) => [
    { level: 'catalog', privilege: 'OWNER', mine: false, me: 'app-sp' }, { level: 'catalog', privilege: 'USE CATALOG', mine: true, me: 'app-sp' },
    { level: 'catalog', privilege: 'USE CATALOG', principal: 'account users', mine: true, me: 'app-sp' },
    { level: 'schema', privilege: 'OWNER', mine: false, me: 'app-sp' },
    ...privileges.map((privilege) => ({ level: 'schema', privilege, mine: true, me: 'app-sp' })),
  ];
  const granted = I.useCaseSchemaBuilderGrant('main', 's', 'app-sp').replace(/^GRANT (.*) ON SCHEMA .*$/, '$1').split(', ');
  assert.equal(I.outputAccess(rowsFrom(granted), 'main.s.n01_u01_results', { builder: true }).write.ok, true);
  assert.equal(I.modelAccess(rowsFrom(granted), 'main.s.n01_u01_results_model', { builder: true }).ok, true);
  assert.equal(I.outputAccess(rowsFrom(granted), 'main.s.n01_u01_results', { builder: true }).app.ok, true, 'a new App can be given read access');
  assert.match(I.outputAccess(rowsFrom(granted.filter((p) => p !== 'MANAGE')), 'main.s.n01_u01_results', { builder: true }).app.detail,
    /needs this access.*GRANT MANAGE ON SCHEMA `main`\.`s` TO `app-sp`/);
  const withoutModel = granted.filter((p) => p !== 'CREATE MODEL');
  assert.match(I.modelAccess(rowsFrom(withoutModel), 'main.s.n01_u01_results_model', { builder: true }).detail, /needs CREATE MODEL on main\.s/);
});

async function call(base, route, opts = {}) {
  const resp = await fetch(base + route, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
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

const schemaRows = (rows) => ({ 'information_schema.schema_tags': (_sql, _p, token) => ({ rows: token === PERSON_TOKEN ? rows : [] }) });

test('context offers the own schema as the default only to a new use case, and falls back with the GRANT when the person cannot create it', async () => {
  await withApp({ forwardedToken: PERSON_TOKEN, statements: schemaRows([RIGHT, ME]) }, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual([got.data.own_schema.table, got.data.own_schema.place, got.data.own_schema.create], [OWN, 'own', true]);
  });
  await withApp({ forwardedToken: PERSON_TOKEN, statements: schemaRows([ME]) }, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.deepEqual([got.data.own_schema.table, got.data.own_schema.place], [INSPIRE, 'inspire']);
    assert.match(got.data.own_schema.note, /GRANT CREATE SCHEMA ON CATALOG `main`/);
  });
  await withApp({ forwardedToken: PERSON_TOKEN, statements: schemaRows([RIGHT, ME, ...tagged(SCHEMA, {})]) }, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.deepEqual([got.data.own_schema.table, got.data.own_schema.create], ['main._inspire_acme_n01_u01__2.n01_u01_results', true]);
    assert.match(got.data.own_schema.note, /so this use case's own schema is _inspire_acme_n01_u01__2\./);
  });
  const built = [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', spec_json: JSON.stringify({ config: { result_table: 'main.inspire.churn_out' } }) }];
  await withApp({ forwardedToken: PERSON_TOKEN, statements: schemaRows([RIGHT, ME]), history: built }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.own_schema, null, 'a use case with a build keeps its table');
    assert.equal(made.sqlCalls.some((c) => c.sql.includes('schema_tags')), false);
  });
});

test('create-schema tags the use case schema and lets the identity Inspire builds as write there', async () => {
  const grants = [];
  const statements = { ...schemaRows([RIGHT]), 'GRANT ': (sql, _p, token) => { grants.push([sql, token]); return { rows: [] }; } };
  await withApp({ forwardedToken: PERSON_TOKEN, tokenKind: 'app', me: { userName: 'inspire-app', applicationId: 'app-sp-1' }, statements }, async (url, made) => {
    const body = { catalog: 'main', schema: '_inspire_acme_n01_u01', tags: w.useCaseSchemaTags({ sessionId: '42', useCaseId: 'N01-U01', businessName: 'Acme', inspireDatabase: '`main`.`inspire`' }) };
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, []);
    const ran = made.sqlCalls.filter((c) => /^(CREATE|ALTER) /.test(c.sql)).map((c) => [c.sql, c.token]);
    assert.deepEqual(ran, [
      ['CREATE SCHEMA IF NOT EXISTS `main`.`_inspire_acme_n01_u01`', PERSON_TOKEN],
      ["ALTER SCHEMA `main`.`_inspire_acme_n01_u01` SET TAGS ('inspire_session_id' = '42', 'inspire_use_case_id' = 'N01-U01', 'inspire_business' = 'Acme', 'inspire_database' = 'main.inspire')", PERSON_TOKEN],
    ]);
    assert.deepEqual(grants, [['GRANT USE SCHEMA, CREATE TABLE, CREATE MODEL, SELECT, MODIFY, MANAGE ON SCHEMA `main`.`_inspire_acme_n01_u01` TO `app-sp-1`', PERSON_TOKEN]]);
  });
  const same = [];
  await withApp({ forwardedToken: PERSON_TOKEN, dbToken: PERSON_TOKEN, statements: { ...schemaRows([RIGHT]), 'GRANT ': (sql) => { same.push(sql); return { rows: [] }; } } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body: { catalog: 'main', schema: 's1', tags: { inspire_session_id: '42' } } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(same, [], 'a person who builds as themselves owns the schema and needs no grant (must-exclude)');
  });
});

test('create-schema on the person route, where the request carries the person token, still lets the App service principal that builds write there', async () => {
  const grants = [];
  const statements = { ...schemaRows([RIGHT]), 'GRANT ': (sql, _p, token) => { grants.push([sql, token]); return { rows: [] }; } };
  const workspace = ({ token, path }) => (path.startsWith('/api/2.0/preview/scim/v2/Me')
    ? [token === 'sp-tok' ? { userName: 'inspire-app', applicationId: 'app-sp-1' } : { userName: 'amr@x' }] : undefined);
  await withApp({ forwardedToken: PERSON_TOKEN, dbToken: PERSON_TOKEN, appToken: 'sp-tok', workspace, statements }, async (url) => {
    const body = { catalog: 'main', schema: '_inspire_acme_n01_u01', tags: w.useCaseSchemaTags({ sessionId: '42', useCaseId: 'N01-U01', businessName: 'Acme', inspireDatabase: 'main.inspire' }) };
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, []);
    assert.deepEqual(grants, [['GRANT USE SCHEMA, CREATE TABLE, CREATE MODEL, SELECT, MODIFY, MANAGE ON SCHEMA `main`.`_inspire_acme_n01_u01` TO `app-sp-1`', PERSON_TOKEN]]);
  });
});

test('create-schema refuses a schema that is not this use case\'s and creates nothing; it goes on for one that is', async () => {
  const body = { catalog: 'main', schema: SCHEMA, tags: { inspire_session_id: '42', inspire_use_case_id: 'N01-U01' } };
  for (const [held, why] of [[tagged(SCHEMA, { inspire_session_id: '1000042', inspire_use_case_id: 'N01-U01' }), /it holds session 1000042/],
  [tagged(SCHEMA, {}), /Inspire did not create it for this use case/],
  [tagged(SCHEMA, { inspire_database: 'other.db', inspire_use_case_id: 'N01-U01' }), /Inspire database other\.db/]]) {
    await withApp({ forwardedToken: PERSON_TOKEN, statements: schemaRows(held) }, async (url, made) => {
      const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
      assert.equal(got.status, 409, JSON.stringify(got.data));
      assert.match(got.data.error, why);
      assert.equal(made.sqlCalls.some((c) => /^(CREATE|ALTER) /.test(c.sql)), false);
    });
  }
  await withApp({ forwardedToken: PERSON_TOKEN, statements: schemaRows(tagged(SCHEMA, { ...LINEAGE, inspire_session_id: '7' })) }, async (url) => {
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
    assert.equal(got.status, 200, JSON.stringify(got.data));
  });
});

test('create-schema on a schema that already exists grants the identity Inspire builds as and never creates or re-tags it', async () => {
  const held = tagged(SCHEMA, { ...LINEAGE, inspire_session_id: '42' });
  const grants = [];
  const statements = { ...schemaRows(held), 'GRANT ': (sql, _p, token) => { grants.push([sql, token]); return { rows: [] }; } };
  await withApp({ forwardedToken: PERSON_TOKEN, tokenKind: 'app', me: { userName: 'inspire-app', applicationId: 'app-sp-1' }, statements }, async (url, made) => {
    const body = { catalog: 'main', schema: SCHEMA, tags: w.useCaseSchemaTags({ sessionId: '42', useCaseId: 'N01-U01', businessName: 'Acme', inspireDatabase: 'main.inspire' }) };
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.existed, true);
    assert.deepEqual(made.sqlCalls.filter((c) => /^(CREATE|ALTER) /.test(c.sql)), [], 'an existing, tagged schema is neither created nor tagged again');
    assert.deepEqual(grants, [['GRANT USE SCHEMA, CREATE TABLE, CREATE MODEL, SELECT, MODIFY, MANAGE ON SCHEMA `main`.`_inspire_acme_n01_u01` TO `app-sp-1`', PERSON_TOKEN]],
      'the builder grant lands on an existing schema, the case that left the build identity without USE SCHEMA and CREATE TABLE');
  });
});

test('the ensure plan creates only a missing schema and tags only one without the Inspire database tag, never an older session of its lineage', () => {
  const tags = { inspire_session_id: '42' };
  assert.deepEqual(I.useCaseSchemaEnsure({}, tags), { create: true, tag: true });
  assert.deepEqual(I.useCaseSchemaEnsure({ exists: true, session: '42' }, tags), { create: false, tag: true }, 'an older schema gets the database tag');
  assert.deepEqual(I.useCaseSchemaEnsure({ exists: true, session: '7', database: 'main.inspire' }, tags), { create: false, tag: false },
    'a schema reused from session 7 keeps its tags (must-exclude), so the next open still keeps session 7 rows apart');
  assert.deepEqual(I.useCaseSchemaEnsure({ exists: true, session: '42' }, null), { create: false, tag: false });
  assert.deepEqual(I.useCaseSchemaEnsure(null, null), { create: true, tag: false });
});

const NOT_CREATED = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: false, me: 'app-sp' },
  { level: 'catalog', privilege: 'USE CATALOG', principal: 'account users', mine: true, me: 'app-sp' },
  { level: 'catalog', privilege: 'CREATE SCHEMA', principal: 'app-sp', mine: true, me: 'app-sp' },
];

test('a use case schema Inspire creates at the Results step passes every build check before it exists: its needs are grants Inspire runs, not gaps', () => {
  const creates = { builder: true, createsSchema: true };
  const got = I.outputAccess(NOT_CREATED, OWN, creates);
  assert.deepEqual([got.write.ok, got.grant.ok, got.app.ok], [true, true, true], JSON.stringify(got));
  assert.match(got.write.detail, /^Inspire creates the schema main\._inspire_acme_n01_u01 for this use case at the Results step, so app-sp, the identity Inspire builds as, can create /);
  assert.deepEqual(I.accessPlan(OWN, NOT_CREATED, '', creates).gaps, []);
  assert.deepEqual(I.accessPlan(OWN, NOT_CREATED, 'app-new', creates).grants.map((g) => [g.privilege, g.level]), [['USE SCHEMA', 'schema'], ['SELECT', 'table']]);
  assert.equal(I.modelAccess(NOT_CREATED, `${OWN}_model`, creates).ok, true);
  assert.deepEqual(I.shareWarnings(OWN, NOT_CREATED, ['analysts'], creates), []);
  assert.equal(I.schemaNotCreated(NOT_CREATED), true);
});

test('a missing schema Inspire does not create still fails, and its reason names the missing schema, never access Inspire lacks (must-exclude)', () => {
  const got = I.outputAccess(NOT_CREATED, OWN, { builder: true });
  assert.deepEqual([got.write.ok, got.app.ok], [false, false]);
  assert.match(got.app.detail, /^a new App cannot read the table: schema main\._inspire_acme_n01_u01 does not exist/);
  assert.doesNotMatch(got.app.detail, /GRANT/);
  assert.equal(w.blockWhy(got.app.detail), 'The schema main._inspire_acme_n01_u01 does not exist, or Inspire cannot see it.');
  assert.equal(w.outputBlocks({ apps: true, genie_spaces: true }, null, {}, { new_app: got.app }).app.why, 'The schema main._inspire_acme_n01_u01 does not exist, or Inspire cannot see it.');
  assert.ok(I.accessPlan(OWN, NOT_CREATED, '').gaps.some((g) => g.level === 'schema'), 'without Inspire creating it the schema need stays a gap');
  assert.equal(I.modelAccess(NOT_CREATED, `${OWN}_model`, { builder: true }).ok, false);
  assert.equal(I.shareWarnings(OWN, NOT_CREATED, ['analysts']).length, 1);
  const noCatalog = I.outputAccess([], OWN, { builder: true, createsSchema: true });
  assert.equal(noCatalog.app.ok, false, 'Inspire never creates a catalog, so a missing catalog is never excused');
  assert.equal(w.blockWhy(noCatalog.app.detail), 'The catalog main does not exist, or Inspire cannot see it.');
  assert.equal(I.schemaNotCreated([]), false);
});

test('an existing schema is never excused as one Inspire creates: a real access gap still shows with its GRANT (must-exclude)', () => {
  const existing = [...NOT_CREATED, { level: 'schema', privilege: 'OWNER', principal: 'someone', mine: false, me: 'app-sp' },
    { level: 'schema', privilege: 'CREATE TABLE', principal: 'app-sp', mine: true, me: 'app-sp' },
    { level: 'schema', privilege: 'USE SCHEMA', principal: 'app-sp', mine: true, me: 'app-sp' }];
  const got = I.outputAccess(existing, OWN, { builder: true, createsSchema: true });
  assert.equal(got.write.ok, true);
  assert.equal(got.app.ok, false);
  assert.match(got.app.detail, /needs this access.*GRANT MANAGE ON SCHEMA/);
  assert.match(w.blockWhy(got.app.detail), /^Needs access Inspire does not have on the schema/);
  assert.equal(I.schemaNotCreated(existing), false);
});

const outputRows = (rows) => ({ 'AS mine, current_user() AS me FROM (': { rows } });

test('preflight on a first run passes the App when the person can create the use case schema, and names the missing schema when they cannot (must-exclude)', async () => {
  const ask = `/api/inspire/implement/preflight?${Q}&result_table=${OWN}&app_name=&merge_app=&genie=1&dashboard=0`;
  const app = { forwardedToken: PERSON_TOKEN, tokenKind: 'app', me: { userName: 'inspire-app', applicationId: 'app-sp' },
    warehousePermissions: { access_control_list: [{ service_principal_name: 'app-sp', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] } };
  await withApp({ ...app, statements: { ...schemaRows([RIGHT, ME]), ...outputRows(NOT_CREATED) } }, async (url) => {
    const got = await call(url, ask);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.new_app.ok, true, JSON.stringify(got.data.new_app));
    assert.equal(got.data.checks.output.ok, true, JSON.stringify(got.data.checks.output));
    assert.deepEqual(w.outputBlocks(got.data.features, null, {}, got.data), {});
  });
  await withApp({ ...app, statements: { ...schemaRows([ME]), ...outputRows(NOT_CREATED) } }, async (url) => {
    const got = await call(url, ask);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.new_app.ok, false);
    assert.equal(w.outputBlocks(got.data.features, null, {}, got.data).app.why, 'The schema main._inspire_acme_n01_u01 does not exist, or Inspire cannot see it.');
  });
  await withApp({ ...app, statements: { ...schemaRows([RIGHT, ME]), ...outputRows(NOT_CREATED) } }, async (url) => {
    const other = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.elsewhere.n01_u01_results&app_name=&merge_app=&genie=1`);
    assert.equal(other.status, 200, JSON.stringify(other.data));
    assert.equal(other.data.new_app.ok, false, 'a missing schema that is not this use case\'s own schema is not one Inspire creates');
  });
});

test('the first run creates the schema the wizard names, even when the session business name names another schema, and the verdict says so (REQ-037, must fail before the fix)', async () => {
  const ask = `/api/inspire/implement/preflight?${Q}&result_table=main._inspire_n01_u01.n01_u01_results&app_name=&merge_app=&genie=1&dashboard=0`;
  const app = { forwardedToken: PERSON_TOKEN, tokenKind: 'app', me: { userName: 'inspire-app', applicationId: 'app-sp' },
    warehousePermissions: { access_control_list: [{ service_principal_name: 'app-sp', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] } };
  await withApp({ ...app, statements: { ...schemaRows([RIGHT, ME]), ...outputRows(NOT_CREATED) } }, async (url) => {
    const got = await call(url, ask);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.checks.output.ok, true, JSON.stringify(got.data.checks.output));
    assert.match(got.data.checks.output.detail, /the First run creates it$/);
    assert.equal(got.data.new_app.ok, true, JSON.stringify(got.data.new_app));
  });
});

test('a missing schema is refused when the person cannot create schemas, even when it is a name Inspire generates (must-exclude, REQ-037)', async () => {
  const ask = `/api/inspire/implement/preflight?${Q}&result_table=main._inspire_n01_u01.n01_u01_results&app_name=&merge_app=&genie=1&dashboard=0`;
  const app = { forwardedToken: PERSON_TOKEN, tokenKind: 'app', me: { userName: 'inspire-app', applicationId: 'app-sp' },
    warehousePermissions: { access_control_list: [{ service_principal_name: 'app-sp', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] } };
  await withApp({ ...app, statements: { ...schemaRows([ME]), ...outputRows(NOT_CREATED) } }, async (url) => {
    const got = await call(url, ask);
    assert.equal(got.data.checks.output.ok, false, JSON.stringify(got.data.checks.output));
    assert.doesNotMatch(got.data.checks.output.detail, /First run creates it/);
    assert.match(got.data.checks.output.detail, /schema main\._inspire_n01_u01 does not exist or you have no access to it/);
    assert.equal(got.data.new_app.ok, false);
  });
});

test('a missing schema with a name Inspire does not generate is refused even with CREATE SCHEMA (must-exclude, REQ-037)', async () => {
  const ask = `/api/inspire/implement/preflight?${Q}&result_table=main._sales_n01_u01.n01_u01_results&app_name=&merge_app=&genie=1&dashboard=0`;
  const app = { forwardedToken: PERSON_TOKEN, tokenKind: 'app', me: { userName: 'inspire-app', applicationId: 'app-sp' },
    warehousePermissions: { access_control_list: [{ service_principal_name: 'app-sp', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] } };
  await withApp({ ...app, statements: { ...schemaRows([RIGHT, ME]), ...outputRows(NOT_CREATED) } }, async (url) => {
    const got = await call(url, ask);
    assert.equal(got.data.checks.output.ok, false, JSON.stringify(got.data.checks.output));
    assert.doesNotMatch(got.data.checks.output.detail, /First run creates it/);
  });
});

test('a schema tag value cut to the Unity Catalog length limit never ends with a space', () => {
  const value = `${'a'.repeat(255)} b`;
  const sql = I.useCaseSchemaTagsSql('main', 's', { inspire_business: value, inspire_session_id: '  42  ' });
  const got = [...sql.matchAll(/'(inspire_[a-z_]+)' = '((?:[^'\\]|\\.)*)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(got, [['inspire_session_id', '42'], ['inspire_business', 'a'.repeat(255)]]);
  for (const [, v] of got) assert.ok(v.length <= 256 && v === v.trim());
  assert.equal(I.useCaseSchemaTagsSql('main', 's', { inspire_business: '   ' }), '');
});
