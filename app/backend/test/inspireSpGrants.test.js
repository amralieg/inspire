const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SG = require('../lib/inspireSpGrants');

test('the demo pipeline gets Inspire\'s client id from the environment, and never looks it up by display name', () => {
  const prior = { DATABRICKS_CLIENT_ID: process.env.DATABRICKS_CLIENT_ID, SP_CLIENT_ID: process.env.SP_CLIENT_ID };
  try {
    delete process.env.SP_CLIENT_ID;
    process.env.DATABRICKS_CLIENT_ID = 'insp-client-1';
    assert.equal(SG.resolveInspireAppServicePrincipalId(), 'insp-client-1');
    assert.equal(SG.resolveInspireAppServicePrincipalId('explicit-2'), 'explicit-2');
    delete process.env.DATABRICKS_CLIENT_ID;
    assert.equal(SG.resolveInspireAppServicePrincipalId(), null, 'absent, so the pipeline warns and grants nothing');
  } finally {
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('the resolver module makes no network call and names no display-name filter', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'inspireSpGrants.js'), 'utf8');
  assert.ok(!src.includes('displayName'), 'no display-name lookup');
  assert.ok(!src.includes('scim'), 'no SCIM call');
});

const BACKEND_FILES = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (['node_modules', 'test', 'build'].includes(e.name)) return [];
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return BACKEND_FILES(full);
  return e.name.endsWith('.js') ? [full] : [];
});

test('closing grep: every SCIM principal query in the backend is a reviewed site, and none resolves Inspire by display name', () => {
  const backend = path.join(__dirname, '..');
  const files = new Set();
  for (const file of BACKEND_FILES(backend)) {
    const text = fs.readFileSync(file, 'utf8');
    if (/scim\/v2\/(ServicePrincipals|Users|Groups)\b/.test(text)) files.add(path.relative(backend, file));
    assert.ok(!text.includes('displayName co "${DEFAULT_APP_NAME}"'), `${path.relative(backend, file)} looks Inspire up by display name`);
  }
  assert.deepEqual([...files].sort(), ['implementRoutes.js'], 'the only principal search is the sharing picker, which takes typed text');
  const picker = fs.readFileSync(path.join(backend, 'implementRoutes.js'), 'utf8');
  assert.ok(!/ServicePrincipals/.test(picker), 'the sharing picker never queries service principals');
});

test('the notebook looks a service principal up only by applicationId, never by display name', () => {
  const nb = fs.readFileSync(path.join(__dirname, '..', '..', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'), 'utf8');
  assert.ok(!nb.includes('displayName co'), 'no display-name filter in the notebook');
  assert.ok(nb.includes('service_principals.list(filter=f\'applicationId eq'), 'the one principal lookup is by applicationId');
});
