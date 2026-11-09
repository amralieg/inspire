const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('splitTechnical moves every GRANT statement out of the sentence a business user reads and keeps it word for word under Details', async () => {
  const { splitTechnical, ASK_OWNER_APP_TEXT } = await lib('plainText.js');
  const grant = 'GRANT USE CATALOG ON CATALOG main TO `app-sp`';
  const select = 'GRANT SELECT ON TABLE main.sales.orders TO `app-sp`';
  const { plain, details } = splitTechnical(`The App cannot read 2 tables. Ask the owner to run: ${grant}; ${select}`);
  assert.equal(plain, `The App cannot read 2 tables. ${ASK_OWNER_APP_TEXT}`);
  assert.deepEqual(details, [grant, select]);
  assert.doesNotMatch(plain, /GRANT|main\.sales/);
});

test('a grant for a service principal asks the owner to give the App the access, never you, and never shows its id; a grant for a person still says you (must-exclude)', async () => {
  const { splitTechnical, ASK_OWNER_APP_TEXT, ASK_OWNER_TEXT } = await lib('plainText.js');
  const sp = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  const wall = `a new App could not read main.sales.out: its service principal needs USE SCHEMA on schema main.sales. Ask the owner to run: GRANT MANAGE ON SCHEMA main.sales TO \`${sp}\`; or choose a result table in a catalog and schema Inspire manages`;
  const { plain, details } = splitTechnical(wall);
  assert.equal(plain, `a new App could not read main.sales.out: its service principal needs USE SCHEMA on schema main.sales. ${ASK_OWNER_APP_TEXT}; or choose a result table in a catalog and schema Inspire manages`);
  assert.doesNotMatch(plain, new RegExp(sp));
  assert.deepEqual(details, [`GRANT MANAGE ON SCHEMA main.sales TO \`${sp}\``]);
  assert.ok(splitTechnical('Ask the owner to run: GRANT SELECT ON TABLE main.s.t TO `pat@example.com`').plain.startsWith(ASK_OWNER_TEXT));
});

test('splitTechnical moves the machine paths and hosts of a build message to Details and keeps workspace folders in the sentence (must-exclude)', async () => {
  const { splitTechnical } = await lib('plainText.js');
  const ready = splitTechnical('Genie Code 0.2.1 is ready and uses the model databricks-gpt-5 (installed at /home/spark-1a2b/.inspire_genie/bin/genie on the x86_64 CPU)');
  assert.equal(ready.plain, 'Genie Code 0.2.1 is ready and uses the model databricks-gpt-5');
  assert.deepEqual(ready.details, ['installed at /home/spark-1a2b/.inspire_genie/bin/genie on the x86_64 CPU']);
  const host = splitTechnical('The model call failed at http://10.0.0.4:8080/ai-gateway/mlflow/v1/chat and Genie stopped.');
  assert.equal(host.plain, 'The model call failed at and Genie stopped.'.replace(' at and', ' and'));
  assert.deepEqual(host.details, ['http://10.0.0.4:8080/ai-gateway/mlflow/v1/chat']);
  const folder = 'Inspire saves to /Workspace/Users/pat@example.com/inspire_output.';
  assert.deepEqual(splitTechnical(folder), { plain: folder, details: [] });
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
  assert.equal(noResultsText({ completed_percent: 100, completed_on: '2026-11-08 10:00:00' }, { inMonitor: true }), 'This run finished without saving a use case.', 'inside Monitor the text never sends the person to Monitor');
  assert.equal(noResultsText({ completed_percent: 100, processing_status: 'failed' }, { inMonitor: true }), 'This run stopped before it saved a use case.');
  for (const text of [finished, RESULTS_PENDING_TEXT]) assert.doesNotMatch(text, /pipeline|starting/i, 'no pipeline wording (must-exclude)');
});

test('splitTechnical unwraps a raw JSON error body and moves the Databricks error code and SQLSTATE to Details, but keeps a setting name in a sentence (must-exclude)', async () => {
  const { splitTechnical } = await lib('plainText.js');
  const body = JSON.stringify({ error: 'PERMISSION_DENIED: User does not have USE SCHEMA on Schema main._inspire.' });
  assert.deepEqual(splitTechnical(`Could not load: ${body}`), {
    plain: 'Could not load: access to schema main._inspire was refused, so ask its owner or a workspace admin to give you access.',
    details: ['PERMISSION_DENIED: User does not have USE SCHEMA on Schema main._inspire.'] });
  assert.deepEqual(splitTechnical('[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`t` cannot be found. SQLSTATE: 42P01'),
    { plain: 'Table main.s.t does not exist, so check that it was not renamed or dropped, or pick another one.',
      details: ['[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`t` cannot be found. SQLSTATE: 42P01'] });
  for (const text of ["WEEKS_LEFT is '60'; allowed: 1 to 52", 'the run ended (CANCELED: Run cancelled)', 'not JSON {"x": 1}']) {
    assert.deepEqual(splitTechnical(text), { plain: text, details: [] }, `"${text}" stays as it is`);
  }
});

const FAILURES = [
  ['network', 'transient', 'TypeError: Failed to fetch', /connection/],
  ['network', 'transient', 'Cannot reach the Databricks workspace (fetch failed; ECONNREFUSED). The workspace did not answer.', /connection/],
  ['signed_out', '', '{"error_code":"401","message":"Invalid access token."}', /reload the page/],
  ['busy', 'transient', '{"error_code":"REQUEST_LIMIT_EXCEEDED","message":"Exceeded rate limit for /api/2.1/unity-catalog/catalogs. Please try again later."}', /wait a minute/],
  ['busy', 'transient', 'The request failed (HTTP 429)', /wait a minute/],
  ['app_limit', '', 'Could not create the App: {"message":"Maximum number of apps (300) reached for workspace 1234123412341234.","error_code":"RESOURCE_EXHAUSTED"}', /delete an App/],
  ['warehouse_gone', '', 'SQL failed (404): {"error_code":"RESOURCE_DOES_NOT_EXIST","message":"SQL warehouse wh1 does not exist."}', /pick another warehouse/],
  ['warehouse_stopped', '', 'Warehouse 4b9b953939869799 is not running. Statement execution is not possible on a stopped warehouse.', /start it/],
  ['not_found', '', '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`t` cannot be found. SQLSTATE: 42P01', /does not exist/],
  ['denied', '', '{"error_code":"PERMISSION_DENIED","message":"User does not have USE SCHEMA on Schema \'sales.retail\'."}', /give you access/],
  ['server', 'transient', '{"error_code":"INTERNAL_ERROR","message":"Internal error. Attach your request ID (4f0c2c1e-9b3d-4f6a-8c1e-2d6b1b9c0a77) when reporting."}', /try again in a minute/],
];

test('every failure a business user can meet reads as one sentence that says what to do, with the raw error under Details', async () => {
  const { splitTechnical, failureCauseOf } = await lib('plainText.js');
  for (const [kind, transient, raw, action] of FAILURES) {
    assert.equal(failureCauseOf(raw)?.kind, kind, raw);
    assert.equal(Boolean(failureCauseOf(raw)?.transient), transient === 'transient', raw);
    const { plain, details } = splitTechnical(raw);
    assert.match(plain, action, raw);
    assert.equal(plain.split(/(?<=\.)\s+(?=[A-Z])/).length, 1, plain);
    assert.doesNotMatch(plain, /[A-Z]{2,}_[A-Z_]+|\{|\}|\b\d{3}\b|[0-9a-f]{8}-[0-9a-f]{4}|\b\d{10,}\b|[0-9a-f]{16}|SQLSTATE|HTTP|Invalid access token/, plain);
    assert.ok(details.length > 0, raw);
  }
});

test('a deterministic failure never promises that trying again helps', async () => {
  const { splitTechnical } = await lib('plainText.js');
  for (const [kind, transient, raw] of FAILURES) {
    if (transient || kind === 'warehouse_stopped' || kind === 'signed_out') continue;
    assert.doesNotMatch(splitTechnical(raw).plain, /try again|retry/i, raw);
  }
});

test('JSON errors are read in any key order and nested bodies are unwrapped', async () => {
  const { splitTechnical } = await lib('plainText.js');
  for (const raw of [
    'Publish failed: {"message":"User does not have permission","error_code":"PERMISSION_DENIED"}',
    'Publish failed: {"error_code":"PERMISSION_DENIED","message":"User does not have permission"}',
    'Publish failed: {"error":"{\\"error_code\\":\\"PERMISSION_DENIED\\",\\"message\\":\\"User does not have permission\\"}"}',
  ]) {
    const { plain, details } = splitTechnical(raw);
    assert.equal(plain, 'Publish failed: User does not have permission, so ask its owner or a workspace admin to give you access.', raw);
    assert.ok(details.join(' ').includes('PERMISSION_DENIED'), raw);
  }
});

test('ids in an error stay under Details, words that only look like codes stay in the sentence', async () => {
  const { splitTechnical } = await lib('plainText.js');
  const { plain, details } = splitTechnical('The App could not start for run 812345678901234 on cluster 0123-456789-abcdef12');
  assert.doesNotMatch(plain, /812345678901234/);
  assert.ok(details.some((d) => d.includes('812345678901234')));
  assert.deepEqual(splitTechnical('Keep WEEKS_LEFT under 52'), { plain: 'Keep WEEKS_LEFT under 52', details: [] });
  assert.deepEqual(splitTechnical('Your table has 12 rows'), { plain: 'Your table has 12 rows', details: [] });
});
