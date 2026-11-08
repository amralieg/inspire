const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('splitTechnical moves every GRANT statement out of the sentence a business user reads and keeps it word for word under Details', async () => {
  const { splitTechnical, ASK_OWNER_TEXT } = await lib('plainText.js');
  const grant = 'GRANT USE CATALOG ON CATALOG main TO `app-sp`';
  const select = 'GRANT SELECT ON TABLE main.sales.orders TO `app-sp`';
  const { plain, details } = splitTechnical(`The App cannot read 2 tables. Ask the owner to run: ${grant}; ${select}`);
  assert.equal(plain, `The App cannot read 2 tables. ${ASK_OWNER_TEXT}`);
  assert.deepEqual(details, [grant, select]);
  assert.doesNotMatch(plain, /GRANT|main\.sales/);
});

test('splitTechnical keeps the clause after the statements and the lower-case ask inside a sentence', async () => {
  const { splitTechnical } = await lib('plainText.js');
  const { plain, details } = splitTechnical('Inspire cannot create the schema; ask the owner of main to run GRANT CREATE SCHEMA ON CATALOG main TO `a@b.com`, then pick Its own schema again.');
  assert.equal(plain, 'Inspire cannot create the schema; ask the owner to give you the access listed under Details, then pick Its own schema again.');
  assert.deepEqual(details, ['GRANT CREATE SCHEMA ON CATALOG main TO `a@b.com`']);
});

test('splitTechnical moves an internal /api/ path to Details and leaves plain text untouched (must-exclude)', async () => {
  const { splitTechnical } = await lib('plainText.js');
  const api = splitTechnical('Lakebase is not available in this workspace (not mocked /api/2.0/postgres/projects?page_size=1).');
  assert.equal(api.plain, 'Lakebase is not available in this workspace.');
  assert.deepEqual(api.details, ['/api/2.0/postgres/projects?page_size=1']);
  for (const text of ['space create 403', 'Run cancelled while v2 was still filling.', 'Grant access in the workspace.', '']) {
    assert.deepEqual(splitTechnical(text), { plain: text, details: [] }, `"${text}" has nothing technical to move`);
  }
});

test('noResultsText says a finished or failed run saved no use case, and only a running run is still writing', async () => {
  const { noResultsText, RESULTS_PENDING_TEXT } = await lib('runPages.js');
  const finished = noResultsText({ completed_percent: 100, completed_on: '2026-11-08 10:00:00' });
  assert.match(finished, /^This run finished without saving a use case/);
  assert.match(noResultsText({ completed_percent: 100, processing_status: 'failed' }), /^This run stopped before it saved a use case/);
  assert.equal(noResultsText({ completed_percent: 40 }), RESULTS_PENDING_TEXT);
  assert.equal(noResultsText(undefined), 'No use case is saved for this run yet.', 'an unknown run claims neither finished nor still writing');
  for (const text of [finished, RESULTS_PENDING_TEXT]) assert.doesNotMatch(text, /pipeline|starting/i, 'no pipeline wording (must-exclude)');
});

test('splitTechnical unwraps a raw JSON error body and moves the Databricks error code and SQLSTATE to Details, but keeps a setting name in a sentence (must-exclude)', async () => {
  const { splitTechnical } = await lib('plainText.js');
  const body = JSON.stringify({ error: 'PERMISSION_DENIED: User does not have USE SCHEMA on Schema main._inspire.' });
  assert.deepEqual(splitTechnical(`Could not load: ${body}`), { plain: 'Could not load: User does not have USE SCHEMA on Schema main._inspire.', details: ['PERMISSION_DENIED'] });
  assert.deepEqual(splitTechnical('[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`t` cannot be found. SQLSTATE: 42P01'),
    { plain: 'The table or view `main`.`s`.`t` cannot be found.', details: ['TABLE_OR_VIEW_NOT_FOUND', 'SQLSTATE: 42P01'] });
  for (const text of ["WEEKS_LEFT is '60'; allowed: 1 to 52", 'the run ended (CANCELED: Run cancelled)', 'not JSON {"x": 1}']) {
    assert.deepEqual(splitTechnical(text), { plain: text, details: [] }, `"${text}" stays as it is`);
  }
});
