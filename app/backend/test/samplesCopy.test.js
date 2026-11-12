const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const I = require('../lib/inspireImplement');

test.after(() => S.stopServer());

const ME = 'analyst@example.com';
const SOURCE = 'samples.bakehouse.sales_transactions';
const DEST = 'main.inspire';
const copyCalls = () => S.state.calls.filter((c) => c.path === '/api/2.0/sql/statements' && /^CREATE TABLE/.test(c.statement));
const copy = (body, person = ME) => S.request('POST', '/api/inspire/samples/copy', { person, body });

test('copying a samples table runs CREATE TABLE AS SELECT into the destination schema with the person sign-in and names the copy', async () => {
  S.reset({ notebookPresent: true });
  const got = await copy({ entries: [SOURCE], destination: DEST });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.copies, [{ source: SOURCE, copy: `${DEST}.sales_transactions` }]);
  assert.deepEqual(got.data.failed, []);
  const sent = copyCalls();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].statement, 'CREATE TABLE `main`.`inspire`.`sales_transactions` AS SELECT * FROM `samples`.`bakehouse`.`sales_transactions`');
  assert.equal(sent[0].token, S.PERSON_TOKEN, 'the copy runs with the person sign-in, not the App');
});

test('a copy the warehouse refuses is named per table, and the other tables still copy', async () => {
  S.reset({ notebookPresent: true, conflictOn: (sql) => (sql.includes('`sales`') ? '[TABLE_OR_VIEW_ALREADY_EXISTS] main.inspire.sales already exists' : '') });
  const got = await copy({ entries: ['samples.bakehouse.sales', 'samples.bakehouse.trips'], destination: DEST });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.copies, [{ source: 'samples.bakehouse.trips', copy: `${DEST}.trips` }]);
  assert.equal(got.data.failed.length, 1);
  assert.equal(got.data.failed[0].source, 'samples.bakehouse.sales');
  assert.match(got.data.failed[0].reason, /already holds a different table/, 'a name taken by another table is named in plain words');
  assert.doesNotMatch(got.data.failed[0].reason, /CREATE TABLE/, 'the reason is plain, without the SQL that failed');
});

test('a table outside samples is never copied, so a mixed pick copies only the samples table (must-exclude)', async () => {
  S.reset({ notebookPresent: true });
  const got = await copy({ entries: ['main.s.orders', SOURCE], destination: DEST });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.copies.map((c) => c.source), [SOURCE]);
  assert.equal(copyCalls().some((c) => c.statement.includes('orders')), false);
});

test('a schema or catalog pick under samples copies every table it holds, and a copy into samples is refused', async () => {
  S.reset({ notebookPresent: true, ucSchemas: { samples: ['bakehouse'] }, ucTables: { 'samples.bakehouse': ['sales', 'trips'] } });
  const bySchema = await copy({ entries: ['samples.bakehouse'], destination: DEST });
  assert.equal(bySchema.status, 200, bySchema.text.slice(0, 300));
  assert.deepEqual(bySchema.data.copies.map((c) => c.source), ['samples.bakehouse.sales', 'samples.bakehouse.trips']);
  const into = await copy({ entries: [SOURCE], destination: 'samples.inspire' });
  assert.equal(into.status, 400);
  assert.match(into.data.error, /own/);
});

test('a copy with no sign-in copies nothing, and a malformed destination is refused before any SQL runs', async () => {
  S.reset({ notebookPresent: true });
  const anon = await S.request('POST', '/api/inspire/samples/copy', { person: ME, signedIn: false, body: { entries: [SOURCE], destination: DEST } });
  assert.equal(anon.status, 401);
  assert.match(anon.data.error, /own sign-in/);
  const bad = await copy({ entries: [SOURCE], destination: 'main' });
  assert.equal(bad.status, 400);
  assert.equal(copyCalls().length, 0);
});

test('a copy that would expand past the read limit is refused, so no picked table silently drops out', async () => {
  const many = Array.from({ length: 101 }, (_, i) => `t${i}`);
  S.reset({ notebookPresent: true, ucSchemas: { samples: ['bakehouse'] }, ucTables: { 'samples.bakehouse': many } });
  const got = await copy({ entries: ['samples.bakehouse'], destination: DEST });
  assert.equal(got.status, 409);
  assert.match(got.data.error, /more tables than one copy can take/);
  assert.equal(copyCalls().length, 0);
});

const COPY_NAME = `${DEST}.sales_transactions`;
const SOURCE_COLUMNS = ['transaction_id', 'amount'];
const copyStatements = (verb) => S.state.calls.filter((c) => c.path === '/api/2.0/sql/statements' && c.statement.startsWith(verb));

test('a copy that already exists with the same columns as the source is reused, not failed and not rewritten (fail-pre: it failed "already exists")', async () => {
  S.reset({
    notebookPresent: true,
    tableColumns: { [SOURCE]: SOURCE_COLUMNS, [COPY_NAME]: SOURCE_COLUMNS },
    conflictOn: (sql) => (sql.startsWith('CREATE TABLE') ? '[TABLE_OR_VIEW_ALREADY_EXISTS] main.inspire.sales_transactions already exists' : ''),
  });
  const got = await copy({ entries: [SOURCE], destination: DEST });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.copies, [{ source: SOURCE, copy: COPY_NAME, reused: true }]);
  assert.deepEqual(got.data.failed, []);
  assert.equal(S.state.calls.some((c) => /REPLACE|DROP TABLE|INSERT|DELETE/.test(c.statement || '')), false, 'an identical copy is never rewritten');
});

test('a table already at the copy name with different columns is never overwritten, and the reason says so in plain words', async () => {
  S.reset({
    notebookPresent: true,
    tableColumns: { [SOURCE]: SOURCE_COLUMNS, [COPY_NAME]: ['order_id'] },
    conflictOn: (sql) => (sql.startsWith('CREATE TABLE') ? '[TABLE_OR_VIEW_ALREADY_EXISTS] main.inspire.sales_transactions already exists' : ''),
  });
  const got = await copy({ entries: [SOURCE], destination: DEST });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.copies, []);
  assert.equal(got.data.failed.length, 1);
  assert.match(got.data.failed[0].reason, /already holds a different table/);
  assert.doesNotMatch(got.data.failed[0].reason, /CREATE TABLE|TABLE_OR_VIEW/, 'the reason is plain, without the SQL or the warehouse code');
  assert.equal(S.state.calls.some((c) => /REPLACE|DROP TABLE/.test(c.statement || '')), false);
});

test('a missing target schema is created with the person sign-in, then the copy runs (fail-pre: it failed "schema does not exist")', async () => {
  let made = false;
  S.reset({
    notebookPresent: true,
    conflictOn: (sql) => {
      if (sql.startsWith('CREATE SCHEMA')) { made = true; return ''; }
      return sql.startsWith('CREATE TABLE') && !made ? '[SCHEMA_NOT_FOUND] The schema `main`.`inspire` cannot be found' : '';
    },
  });
  const got = await copy({ entries: [SOURCE], destination: DEST });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.copies, [{ source: SOURCE, copy: COPY_NAME }]);
  assert.deepEqual(got.data.failed, []);
  const schema = copyStatements('CREATE SCHEMA');
  assert.equal(schema.length, 1);
  assert.equal(schema[0].statement, 'CREATE SCHEMA IF NOT EXISTS `main`.`inspire`');
  assert.equal(schema[0].token, S.PERSON_TOKEN, 'the schema is created with the person sign-in, not the App');
});

test('a missing target schema the person cannot create answers 409 with the exact statement to copy', async () => {
  S.reset({
    notebookPresent: true,
    conflictOn: (sql) => {
      if (sql.startsWith('CREATE SCHEMA')) return '[PERMISSION_DENIED] User does not have CREATE SCHEMA on Catalog main';
      return sql.startsWith('CREATE TABLE') ? '[SCHEMA_NOT_FOUND] The schema `main`.`inspire` cannot be found' : '';
    },
  });
  const got = await copy({ entries: [SOURCE], destination: DEST });
  assert.equal(got.status, 409, got.text.slice(0, 300));
  assert.match(got.data.error, /main\.inspire does not exist/);
  assert.match(got.data.error, /cannot create it/);
  assert.ok(got.data.error.includes('CREATE SCHEMA IF NOT EXISTS `main`.`inspire`'), 'the message carries the exact statement to copy');
  assert.equal(copyStatements('CREATE TABLE').length, 1, 'no table copy is retried after the schema cannot be created');
});

test('the copy failure classifier and the schema and table references are shared helpers', () => {
  assert.equal(I.sampleCopyFailureKind('CREATE TABLE x: [TABLE_OR_VIEW_ALREADY_EXISTS] main.a.b already exists'), 'exists');
  assert.equal(I.sampleCopyFailureKind('CREATE TABLE x: [SCHEMA_NOT_FOUND] The schema cannot be found'), 'no_schema');
  assert.equal(I.sampleCopyFailureKind('CREATE TABLE x: [PERMISSION_DENIED] no access'), '');
  assert.equal(I.schemaCreateStatement({ catalog: 'main', schema: 'inspire' }), 'CREATE SCHEMA IF NOT EXISTS `main`.`inspire`');
  assert.equal(I.sampleTableRef('samples.bakehouse.sales'), '`samples`.`bakehouse`.`sales`');
});

test('the destination and sample-name checks are shared helpers', () => {
  assert.deepEqual(I.schemaParts('main.inspire'), { catalog: 'main', schema: 'inspire' });
  assert.throws(() => I.schemaParts('main.inspire.x'), /must be catalog.schema/);
  assert.equal(I.isBuiltInSampleEntry('samples.bakehouse'), true);
  assert.equal(I.isBuiltInSampleEntry('main.samples'), false);
});
