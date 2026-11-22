// REQ-478, REQ-456, REQ-469: Inspire writes results only where the identity it builds as can create tables and give the new App access.
// A use case schema an earlier install made (its identity since deleted) is never reused, and a result table Inspire cannot write or
// open to the new App moves to the Inspire-managed schema with one info line, so Build never stops on a permission.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const APP_TOKEN = 'tok';
const SCHEMA = '_inspire_acme_n01_u01';
const NEXT = 'main._inspire_acme_n01_u01__2.n01_u01_results';
const MANAGED = 'main.inspire.n01_u01_s42_out';
const STRANDED = 'main._inspire_old_n01_u01.n01_u01_results';
const INFO = `Inspire writes the result to ${MANAGED}, where it can give the new App access`;
const RIGHT = { kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' };
const ME = { kind: 'me', schema_name: '', value: 'app-sp' };
const READ = { kind: 'rights', schema_name: '', value: '' };
const LINEAGE = { inspire_database: 'main.inspire', inspire_use_case_id: 'N01-U01', inspire_session_id: '42' };
const tagged = (schema, tags) => [{ kind: 'exists', schema_name: schema, value: '' },
  ...Object.entries(tags).map(([kind, value]) => ({ kind, schema_name: schema, value }))];
const place = (rows) => I.useCaseSchemaPlace({ inspireDatabase: 'main.inspire', useCaseId: 'N01-U01', sessionId: '42', businessName: 'Acme', rows });

// What the identity Inspire builds as sees on a result schema it holds no right on (the owner is another principal).
const NOT_MINE = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'app-sp' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'app-sp' },
  { level: 'catalog', privilege: 'CREATE_SCHEMA', principal: 'app-sp', mine: 'true', me: 'app-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'someone-gone', mine: 'false', me: 'app-sp' },
];
// It can write there, but cannot give a new App USE SCHEMA (no MANAGE, and account users lack USE SCHEMA).
const WRITES_NO_GRANT = [...NOT_MINE,
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'app-sp', mine: 'true', me: 'app-sp' },
  { level: 'schema', privilege: 'CREATE_TABLE', principal: 'app-sp', mine: 'true', me: 'app-sp' }];

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

test('the schema statement also reads the rights the identity Inspire builds as holds on each candidate schema', () => {
  const got = I.useCaseSchemaStatement('main', [SCHEMA]);
  assert.match(got.sql, /information_schema\.schema_privileges/);
  assert.match(got.sql, /schema_owner/);
  assert.match(got.sql, /'rights'/);
});

test('a use case schema an earlier install made, where Inspire now holds no right, is skipped for a new schema Inspire creates and owns', () => {
  const got = place([...tagged(SCHEMA, LINEAGE), RIGHT, ME, READ]);
  assert.deepEqual([got.table, got.place, got.create], [NEXT, 'own', true], JSON.stringify(got));
  assert.match(got.note, /^_inspire_acme_n01_u01 is from an earlier Inspire install that this App cannot write to, so this use case's own schema is _inspire_acme_n01_u01__2\.$/);
  assert.doesNotMatch(got.note, /service principal|identity Inspire builds as|GRANT/);
});

test('the earlier use case schema is still reused when Inspire owns or manages it, or owns or manages the catalog', () => {
  for (const right of [{ kind: 'schema_right', schema_name: SCHEMA, value: 'OWNER' }, { kind: 'schema_right', schema_name: SCHEMA, value: 'MANAGE' },
    { kind: 'schema_right', schema_name: SCHEMA, value: 'ALL_PRIVILEGES' }, { kind: 'right', schema_name: '', value: 'OWNER' }, { kind: 'right', schema_name: '', value: 'MANAGE' }]) {
    const got = place([...tagged(SCHEMA, LINEAGE), RIGHT, ME, READ, right]);
    assert.deepEqual([got.table, got.place, got.create], ['main._inspire_acme_n01_u01.n01_u01_results', 'own', false], JSON.stringify(right));
  }
});

const schemaRows = (rows) => ({ 'information_schema.schema_tags': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? rows : [] }) });

test('create-schema refuses an earlier install\'s schema Inspire cannot use and runs no statement on it', async () => {
  const body = { catalog: 'main', schema: SCHEMA, tags: { inspire_session_id: '42', inspire_use_case_id: 'N01-U01', inspire_database: 'main.inspire' } };
  await withApp({ forwardedToken: 'person-tok', statements: schemaRows([...tagged(SCHEMA, LINEAGE), RIGHT, ME, READ]) }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/create-schema?${Q}`, { method: 'POST', body });
    assert.equal(got.status, 409, JSON.stringify(got.data));
    assert.match(got.data.error, /earlier Inspire install that this App cannot write to/);
    assert.equal(made.sqlCalls.some((c) => /^(CREATE|ALTER|GRANT) /.test(c.sql)), false);
  });
});

test('the What to deliver check moves a result table Inspire cannot write to the Inspire-managed schema and says where', async () => {
  await withApp({ accessBySchema: { _inspire_old_n01_u01: NOT_MINE } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/output-check?${Q}&table=${STRANDED}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.ok, true, JSON.stringify(got.data));
    assert.equal(got.data.table, MANAGED);
    assert.deepEqual(got.data.result_table_moved, { from: STRANDED, to: MANAGED, detail: INFO });
    assert.doesNotMatch(JSON.stringify(got.data), /the identity Inspire builds as, needs/);
  });
});

test('the What to deliver check moves a result table a new App could not read to the Inspire-managed schema', async () => {
  await withApp({ accessBySchema: { _inspire_old_n01_u01: WRITES_NO_GRANT } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/output-check?${Q}&table=${STRANDED}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.app.ok, true, JSON.stringify(got.data.app));
    assert.equal(got.data.result_table_moved.to, MANAGED);
    assert.doesNotMatch(JSON.stringify(got.data), /a new App could not read the result table/);
  });
});

const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '' };
const SAVED = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: STRANDED }, outputs: { dashboard: true } };
const insertedSpec = (made) => JSON.parse(made.sqlCalls.find((c) => /^INSERT/.test(String(c.sql)) && String(c.sql).includes('__inspire_implement'))
  .parameters.find((p) => p.name === 'spec').value);

test('a saved plan whose result table Inspire cannot write builds into the Inspire-managed schema with the info line, and never stops', async () => {
  await withApp({ useCase: USE_CASE, forwardedToken: 'person-token', accessBySchema: { _inspire_old_n01_u01: NOT_MINE } }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SAVED } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
    assert.equal(got.data.summary.result_table_moved.detail, INFO);
    assert.equal(insertedSpec(made).config.result_table, MANAGED);
  });
});

test('a picked table already in the Inspire-managed schema that Inspire cannot write still says why: there is nowhere better to move it', async () => {
  const refused = [NOT_MINE[0], NOT_MINE[1], NOT_MINE[3]];
  await withApp({ access: refused }, async (url) => {
    const got = await call(url, `/api/inspire/implement/output-check?${Q}&table=main.inspire.churn_out`);
    assert.equal(got.data.ok, false);
    assert.equal(got.data.result_table_moved, undefined);
  });
});
