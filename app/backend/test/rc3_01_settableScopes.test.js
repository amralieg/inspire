// RC3-01 acceptance (frozen): the App user scopes Inspire asks for are only scopes the Apps API accepts.
// The rc.3 install was refused with "The specified scope iam.access-control:read is not a valid scope". The default scopes
// (iam.access-control:read, iam.current-user:read) come with every App and are never asked for; a route that needs one is
// still covered (docs.databricks.com dev-tools/databricks-apps/auth, "Supported user authorization scopes").
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/routePolicy');

const SETTABLE = ['ai-functions', 'ai-gateway', 'apps', 'files', 'genie', 'model-serving', 'postgres', 'sandbox', 'sql', 'vector-search',
  'sql:read', 'sql:restricted-query',
  ...['catalog.catalogs', 'catalog.connections', 'catalog.schemas', 'catalog.tables', 'workspace.workspace'].flatMap((s) => [s, `${s}:read`])];
const DEFAULT = ['iam.access-control:read', 'iam.current-user:read'];

test('RC3-01: every App user scope Inspire asks for is settable, and no default scope is asked for', () => {
  const scopes = P.appUserScopes();
  assert.deepEqual(scopes.filter((s) => !SETTABLE.includes(s)), [], 'not a settable Databricks Apps user scope');
  assert.deepEqual(scopes.filter((s) => DEFAULT.includes(s)), [], 'a default scope is never asked for');
  for (const s of ['apps', 'catalog.catalogs:read', 'catalog.schemas:read', 'catalog.tables:read', 'files', 'sql', 'workspace.workspace']) {
    assert.ok(scopes.includes(s), `${s} stays`);
  }
});

test('RC3-01: the people search still counts as covered, because its scope is a default one', () => {
  const entry = P.ROUTE_POLICY['GET /api/inspire/implement/principals'];
  assert.ok(entry, 'the principals route is in the policy');
  assert.equal(entry.identity, 'person');
  const scopes = P.appUserScopes();
  for (const scope of entry.scopes || []) {
    assert.ok(P.scopeCovers(scopes, scope) || DEFAULT.includes(scope), `${scope} is neither asked for nor a default scope`);
  }
});
