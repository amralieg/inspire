const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { quotedIdent } = require('../../frontend/src/lib/tableName.js');
const L = require('../lib/launchLedger');
const D = require('../lib/demoDataTemplates');

const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const empty = [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'name' }] } }, result: { data_array: [] } }];

function answer(call) {
  if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: PERSON_EMAIL }];
  if (call.path.startsWith('/api/2.1/unity-catalog/schemas') || call.path.startsWith('/api/2.1/unity-catalog/tables')) return [200, {}];
  if (call.path === '/api/2.0/sql/statements') return empty;
  return null;
}

async function statementsFor(paths) {
  const workspace = await fakeWorkspace(answer);
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent' });
    for (const path of paths) {
      const resp = await fetch(`${inspire.url}${path}`, { headers: signedIn });
      assert.equal(resp.status, 200, `${path}: ${await resp.text()}`);
    }
    return workspace.calls.filter((c) => c.path === '/api/2.0/sql/statements').map((c) => c.body.statement);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('the picker fallback quotes a catalog or schema with a backtick in it, so it lists that object and never a look-alike (must-exclude)', async () => {
  const statements = await statementsFor([
    `/api/catalogs/${encodeURIComponent('we`ird')}/schemas?warehouse_id=wh`,
    `/api/tables/${encodeURIComponent('we`ird')}/${encodeURIComponent('s`x')}?warehouse_id=wh`,
  ]);
  assert.ok(statements.includes('SHOW SCHEMAS IN `we``ird`'), JSON.stringify(statements));
  assert.ok(statements.includes('SHOW TABLES IN `we``ird`.`s``x`'), JSON.stringify(statements));
  assert.ok(!statements.some((s) => s.includes('`weird`') || s.includes('`sx`')), 'a backtick is never dropped from a name');
});

test('every backend identifier builder quotes through the one shared helper', () => {
  assert.equal(quotedIdent('a`b'), '`a``b`');
  assert.equal(L.launchTableName('Main.Inspire'), ['Main', 'Inspire', '__inspire_launch'].map(quotedIdent).join('.'));
  assert.equal(L.launchTableName('ma`in.inspire'), null);
  const plan = D.buildDemoDataPlan({ catalog: 'c`at', schema: 's', templateKey: 'saas' });
  assert.equal(plan.statements[0], 'CREATE SCHEMA IF NOT EXISTS `c``at`.`s`');
});
