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
  assert.match(got.data.failed[0].reason, /TABLE_OR_VIEW_ALREADY_EXISTS/);
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

test('the destination and sample-name checks are shared helpers', () => {
  assert.deepEqual(I.schemaParts('main.inspire'), { catalog: 'main', schema: 'inspire' });
  assert.throws(() => I.schemaParts('main.inspire.x'), /must be catalog.schema/);
  assert.equal(I.isBuiltInSampleEntry('samples.bakehouse'), true);
  assert.equal(I.isBuiltInSampleEntry('main.samples'), false);
});
