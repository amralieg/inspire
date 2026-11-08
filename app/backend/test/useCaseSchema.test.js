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
const OWN = 'main._inspire_acme_n01_u01_42.n01_u01_results';
const INSPIRE = 'main.inspire.n01_u01_s42_out';

for (const c of SHARED.cases) {
  test(`the App names the use case schema like the shared case: ${c.name}`, () => {
    assert.equal(w.defaultResultTable(c.inspire_database, c.use_case_id, c.session_id, c.business_name, { wholeSid: c.whole_sid }), c.table);
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

test('an own schema that already holds this session is used as it is, without the right to create one', () => {
  const schema = '_inspire_acme_n01_u01_42';
  const got = place([{ kind: 'exists', schema_name: schema, value: '' }, { kind: 'session', schema_name: schema, value: '42' }]);
  assert.deepEqual([got.table, got.place, got.create, got.note], [OWN, 'own', false, '']);
});

test('a schema whose session tag names another session offers the name with the full session id', () => {
  const sid = '1234567848213';
  const short = '_inspire_acme_n01_u01_48213';
  const whole = 'main._inspire_acme_n01_u01_1234567848213.n01_u01_results';
  const clash = [{ kind: 'exists', schema_name: short, value: '' }, { kind: 'session', schema_name: short, value: '9999948213' }, RIGHT];
  const got = I.useCaseSchemaPlace({ inspireDatabase: 'main.inspire', useCaseId: 'N01-U01', sessionId: sid, businessName: 'Acme', rows: clash });
  assert.deepEqual([got.table, got.place, got.create, got.own_table], [whole, 'own', true, whole]);
  assert.match(got.note, /already holds the tables of session 9999948213/);
  const both = [...clash, { kind: 'exists', schema_name: '_inspire_acme_n01_u01_1234567848213', value: '' },
    { kind: 'session', schema_name: '_inspire_acme_n01_u01_1234567848213', value: '77' }];
  const blocked = I.useCaseSchemaPlace({ inspireDatabase: 'main.inspire', useCaseId: 'N01-U01', sessionId: sid, businessName: 'Acme', rows: both });
  assert.deepEqual([blocked.table, blocked.place, blocked.own_table], ['main.inspire.n01_u01_s1234567848213_out', 'inspire', '']);
});

test('the schema statement reads existence, the session tag, the person\'s catalog rights and who they are, parameterised', () => {
  const got = I.useCaseSchemaStatement('main', ['_Inspire_A', '_inspire_a']);
  assert.match(got.sql, /information_schema\.schema_tags/);
  assert.match(got.sql, /tag_name = 'inspire_session_id'/);
  assert.match(got.sql, /catalog_privileges/);
  assert.deepEqual(got.parameters.map((p) => [p.name, p.value]), [['c', 'main'], ['s0', '_inspire_a']]);
  assert.equal(I.useCaseSchemaTagsSql('main', 's', { inspire_session_id: '42', inspire_use_case_id: 'N01-U01', inspire_business: "Acme's" }),
    "ALTER SCHEMA `main`.`s` SET TAGS ('inspire_session_id' = '42', 'inspire_use_case_id' = 'N01-U01', 'inspire_business' = 'Acme\\'s')");
  assert.equal(I.useCaseSchemaBuilderGrant('main', 's', 'app-sp'), 'GRANT USE SCHEMA, CREATE TABLE, SELECT, MODIFY, MANAGE ON SCHEMA `main`.`s` TO `app-sp`');
  assert.equal(I.useCaseSchemaBuilderGrant('main', 's', 'x`y'), '');
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
    const body = { catalog: 'main', schema: '_inspire_acme_n01_u01_42', tags: w.useCaseSchemaTags({ sessionId: '42', useCaseId: 'N01-U01', businessName: 'Acme' }) };
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, []);
    const ran = made.sqlCalls.filter((c) => /^(CREATE|ALTER) /.test(c.sql)).map((c) => [c.sql, c.token]);
    assert.deepEqual(ran, [
      ['CREATE SCHEMA IF NOT EXISTS `main`.`_inspire_acme_n01_u01_42`', PERSON_TOKEN],
      ["ALTER SCHEMA `main`.`_inspire_acme_n01_u01_42` SET TAGS ('inspire_session_id' = '42', 'inspire_use_case_id' = 'N01-U01', 'inspire_business' = 'Acme')", PERSON_TOKEN],
    ]);
    assert.deepEqual(grants, [['GRANT USE SCHEMA, CREATE TABLE, SELECT, MODIFY, MANAGE ON SCHEMA `main`.`_inspire_acme_n01_u01_42` TO `app-sp-1`', PERSON_TOKEN]]);
  });
  const same = [];
  await withApp({ forwardedToken: PERSON_TOKEN, dbToken: PERSON_TOKEN, statements: { ...schemaRows([RIGHT]), 'GRANT ': (sql) => { same.push(sql); return { rows: [] }; } } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body: { catalog: 'main', schema: 's1', tags: { inspire_session_id: '42' } } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(same, [], 'a person who builds as themselves owns the schema and needs no grant (must-exclude)');
  });
});

test('create-schema refuses a schema whose session tag names another session and creates nothing', async () => {
  const held = [{ kind: 'exists', schema_name: '_inspire_acme_n01_u01_42', value: '' }, { kind: 'session', schema_name: '_inspire_acme_n01_u01_42', value: '1000042' }];
  await withApp({ forwardedToken: PERSON_TOKEN, statements: schemaRows(held) }, async (url, made) => {
    const body = { catalog: 'main', schema: '_inspire_acme_n01_u01_42', tags: { inspire_session_id: '42' } };
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
    assert.equal(got.status, 409, JSON.stringify(got.data));
    assert.match(got.data.error, /session 1000042/);
    assert.equal(made.sqlCalls.some((c) => /^(CREATE|ALTER) /.test(c.sql)), false);
  });
});
