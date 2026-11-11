const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../lib/inspireImplement');
const JP = require('../lib/inspireJobParams');
const SG = require('../lib/inspireSpGrants');

test('the build receives Inspire App client id from the environment only, and an unset one is passed as empty', () => {
  assert.equal(SG.ownServicePrincipalId({ DATABRICKS_CLIENT_ID: ' insp-client-1 ' }), 'insp-client-1');
  assert.equal(SG.ownServicePrincipalId({ SP_CLIENT_ID: 'insp-2' }), 'insp-2');
  assert.equal(SG.ownServicePrincipalId({}), '');
});

test('the identity rides the implement job parameters and survives the notebook parameter filter', () => {
  const built = I.implementJobParams({ '02_inspire_database': 'main.inspire' }, 'N01-U01', 3, 'insp-client-1');
  assert.equal(built.inspire_app_client_id, 'insp-client-1');
  assert.equal(JP.sanitizeInspireNotebookJobParams({ ...built }).inspire_app_client_id, 'insp-client-1');
  assert.equal(I.implementJobParams({}, 'N01-U01', 3).inspire_app_client_id, '');
  assert.equal(JP.INSPIRE_JOB_ONLY_PARAM_KEYS.includes(I.IMPLEMENT_INSPIRE_CLIENT_PARAM), true);
});

test('the implement build never looks Inspire up by display name', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  const start = routes.indexOf('async function startVersion');
  const body = routes.slice(start, routes.indexOf('\n  }\n', start));
  assert.ok(start > 0 && body.includes('ownServicePrincipalId()'), 'the build passes the identity from the environment');
  assert.ok(!body.includes('resolveInspireAppServicePrincipalId'), 'the build never resolves the identity by name');
});
