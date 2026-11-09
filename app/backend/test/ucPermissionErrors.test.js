const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'ucPermissionErrors.js')).href;

test('the permission checklist asks for the Inspire schema volume privileges the run log needs', async () => {
  const { interpretUcPermissionError } = await import(libUrl);
  const out = interpretUcPermissionError(
    'PERMISSION_DENIED: User does not have WRITE VOLUME on Volume main._inspire.vol_root',
    { inspireDatabase: 'main._inspire', context: 'launch' },
  );
  assert.equal(out.isPermissionIssue, true);
  const schemaGrant = out.adminBullets.find((b) => b.includes('ON SCHEMA `main`.`_inspire`') && b.includes('CREATE TABLE'));
  assert.ok(schemaGrant, out.adminBullets.join('\n'));
  assert.match(schemaGrant, /CREATE TABLE, MODIFY, SELECT, CREATE VOLUME, READ VOLUME, WRITE VOLUME ON SCHEMA/);
  assert.match(out.adminEmailText, /WRITE VOLUME ON SCHEMA `main`\.`_inspire`/);
});

test('the API error parser reads error, message and error_message, stringifies a structured one, and keeps any other text as it is', async () => {
  const { parseApiErrorMessage, apiErrorDetail } = await import(libUrl);
  assert.equal(parseApiErrorMessage('{"error":{"code":"BAD"}}'), '{"code":"BAD"}');
  assert.equal(parseApiErrorMessage('{"message":"denied"}'), 'denied');
  assert.equal(parseApiErrorMessage('{"error_message":"no such job"}'), 'no such job');
  assert.equal(parseApiErrorMessage('"plain"'), 'plain');
  assert.equal(parseApiErrorMessage('{"other":1}'), '{"other":1}');
  assert.equal(parseApiErrorMessage('null'), 'null');
  assert.equal(parseApiErrorMessage('403 Forbidden'), '403 Forbidden');
  assert.equal(parseApiErrorMessage('  '), '');
  assert.equal(apiErrorDetail(null), '');
  assert.equal(apiErrorDetail('text'), '');
  assert.equal(apiErrorDetail({ error: '', message: 'm' }), 'm');
  assert.equal(apiErrorDetail({}), '');
});

test('a refusal says Get Started stopped only when it came from Get Started, and a list read never does (must-exclude)', async () => {
  const { interpretUcPermissionError } = await import(libUrl);
  const raw = "PERMISSION_DENIED: User does not have USE CATALOG on Catalog 'main'.";
  assert.match(interpretUcPermissionError(raw, { context: 'launch' }).userMessage, /^Get Started stopped/);
  for (const opts of [{}, { context: 'catalog_browse' }]) {
    const out = interpretUcPermissionError(raw, opts);
    assert.doesNotMatch(out.userMessage, /Get Started/, JSON.stringify(opts));
    assert.equal(out.userMessage.split(/(?<=\.)\s+(?=[A-Z])/).length, 1);
  }
  assert.equal(interpretUcPermissionError('{"error_code":"REQUEST_LIMIT_EXCEEDED","message":"Exceeded rate limit for /api/2.1/unity-catalog/catalogs."}', { context: 'catalog_browse' }).isPermissionIssue, false,
    'Databricks being busy is not a missing permission');
  for (const raw of ['Inspire could not list the tables of main.s: listing failed', 'Inspire could not list the schemas of sales: the catalog list timed out']) {
    assert.equal(interpretUcPermissionError(raw, { context: 'catalog_browse' }).isPermissionIssue, false, `a failure that names a catalog or table is not a refusal: ${raw}`);
  }
});
