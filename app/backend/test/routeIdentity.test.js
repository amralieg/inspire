const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/routePolicy');

const DOCUMENTED_USER_SCOPES = ['ai-functions', 'ai-gateway', 'apps', 'files', 'genie', 'model-serving', 'postgres', 'sql', 'vector-search',
  'sql:restricted-query', 'iam.access-control:read', 'iam.current-user:read',
  ...['catalog.catalogs', 'catalog.connections', 'catalog.schemas', 'catalog.tables', 'workspace.workspace'].flatMap((s) => [s, `${s}:read`])];
const req = (query = {}, body = undefined) => ({ query, body });
const personRoutes = () => Object.entries(P.ROUTE_POLICY).filter(([, e]) => e.identity === 'person');
const scopedRoutes = () => Object.entries(P.ROUTE_POLICY).filter(([, e]) => e.identity === 'person' || e.outputWrite === true);

test('a person route reads with the person, an App route with the App, and an unknown route with the person', () => {
  assert.equal(P.identityFor('GET /api/workspace/list', req(), 'main.inspire'), 'person');
  assert.equal(P.identityFor('GET /api/catalogs', req(), 'main.inspire'), 'person');
  assert.equal(P.identityFor('GET /api/inspire/implement/values', req(), 'main.inspire'), 'person');
  assert.equal(P.identityFor('GET /api/health', req(), 'main.inspire'), 'app');
  assert.equal(P.identityFor('POST /api/setup/create-database', req(), 'main.inspire'), 'app');
  assert.equal(P.identityFor('GET /api/not-declared', req(), 'main.inspire'), 'person');
  assert.equal(P.identityFor(undefined, req(), 'main.inspire'), 'person');
});

test('a tracking route reads with the App only in the App database; another database, or none set, reads with the person (must-exclude)', () => {
  const key = 'GET /api/inspire/sessions';
  assert.equal(P.identityFor(key, req({ inspire_database: 'main.inspire' }), 'main.inspire'), 'app');
  assert.equal(P.identityFor(key, req({ inspire_database: ' MAIN.Inspire ' }), 'main.inspire'), 'app');
  assert.equal(P.identityFor(key, req({ inspire_database: 'other.inspire' }), 'main.inspire'), 'person');
  assert.equal(P.identityFor(key, req({}), 'main.inspire'), 'person');
  assert.equal(P.identityFor(key, req({ inspire_database: 'main.inspire' }), ''), 'person');
  assert.equal(P.identityFor('POST /api/inspire/feedback', req({}, { inspire_database: 'main.inspire' }), 'main.inspire'), 'app');
  assert.equal(P.identityFor('POST /api/inspire/feedback', req({}, { inspire_database: 'hr.inspire' }), 'main.inspire'), 'person');
  assert.equal(P.identityFor('GET /api/health', req({ inspire_database: 'hr.inspire' }), 'main.inspire'), 'app', 'an App route that names no database ignores one');
});

test('the refusal for a person route with no sign-in names the route and the fix, and carries no token', () => {
  const body = P.noPersonTokenBody('GET /api/workspace/list');
  assert.equal(body.error, P.NO_PERSON_TOKEN);
  assert.match(body.error, /your own sign-in/);
  assert.match(body.error, /re-run the Inspire installer/);
  assert.deepEqual(body.policy, { route: 'GET /api/workspace/list', identity: 'person', needs: P.IDENTITIES.person });
});

test('the App user scopes are derived from the person routes plus the manager check, and every one is a documented Apps user scope', () => {
  const scopes = P.appUserScopes();
  assert.deepEqual(scopes, [...new Set(scopes)].sort());
  assert.ok(scopes.includes('apps'), 'the manager check reads the App permissions with the person token');
  assert.deepEqual(scopes.filter((s) => !DOCUMENTED_USER_SCOPES.includes(s)), [], 'not a documented Databricks Apps user scope');
  assert.ok(!scopes.some((s) => /access-management/.test(s)));
  for (const [key, entry] of scopedRoutes()) {
    assert.ok(entry.scopes.length, `${key} names no scope`);
    for (const scope of entry.scopes) assert.ok(P.scopeCovers(scopes, scope), `${key}: ${scope} is not in the App scope list`);
  }
  const used = new Set([...P.MANAGER_SCOPES, ...scopedRoutes().flatMap(([, e]) => e.scopes)]);
  assert.deepEqual(scopes.filter((s) => !used.has(s)), [], 'a scope no person route needs');
});

test('the scope list drops a scope when no route needs it and adds one a new person route needs (must-fail)', () => {
  const table = {
    'GET /a': { identity: 'person', scopes: ['sql'] },
    'GET /b': { identity: 'app', why: 'reads the tracking tables of the App', scopes: ['files'] },
  };
  assert.deepEqual(P.appUserScopes(table), ['apps', 'sql']);
  assert.deepEqual(P.appUserScopes({ ...table, 'GET /c': { identity: 'person', scopes: ['catalog.tables:read'] } }), ['apps', 'catalog.tables:read', 'sql']);
  const both = { ...table, 'GET /c': { identity: 'person', scopes: ['workspace.workspace:read'] }, 'POST /d': { identity: 'app', outputWrite: true, scopes: ['workspace.workspace'] } };
  assert.deepEqual(P.appUserScopes(both), ['apps', 'sql', 'workspace.workspace'], 'the write scope covers the read one');
  assert.deepEqual(P.appUserScopes({ ...both, 'POST /d': { identity: 'app', scopes: ['workspace.workspace'] } }), ['apps', 'sql', 'workspace.workspace:read'],
    'an App route that writes no output check adds no scope');
  assert.equal(P.scopeCovers(['workspace.workspace'], 'workspace.workspace:read'), true);
  assert.equal(P.scopeCovers(['workspace.workspace:read'], 'workspace.workspace'), false, 'a read scope never covers a write');
  assert.equal(P.scopeCovers(['catalog.tables'], 'catalog.schemas:read'), false);
});

test('reads use :read scopes where the route only reads, and the person routes are the reads that browse what a person picks', () => {
  const writers = scopedRoutes().filter(([, e]) => e.outputWrite === true).map(([key]) => key).sort();
  assert.deepEqual(writers, ['POST /api/demo-data/start', 'POST /api/documents', 'POST /api/output-folder/check', 'POST /api/run', 'POST /api/run/:runId/again'], 'only the routes that write into the folder the person picks probe it');
  for (const key of writers) assert.deepEqual(P.ROUTE_POLICY[key].scopes, P.OUTPUT_WRITE_SCOPES, key);
  for (const [key, entry] of personRoutes().filter(([, e]) => e.outputWrite !== true)) {
    for (const scope of entry.scopes) {
      if (/^(catalog|workspace)\./.test(scope)) assert.match(scope, /:read$/, `${key} only reads, so ${scope} needs :read`);
    }
  }
  const keys = personRoutes().map(([key]) => key);
  for (const key of ['GET /api/workspace/list', 'GET /api/workspace/export', 'GET /api/workspace/status', 'GET /api/catalogs', 'GET /api/catalogs/:catalog/schemas',
    'GET /api/tables/:catalog/:schema', 'GET /api/warehouses', 'GET /api/inspire/implement/columns',
    'GET /api/inspire/implement/values', 'POST /api/inspire/implement/swaps', 'POST /api/inspire/implement/readiness']) {
    assert.ok(keys.includes(key), `${key} must read with the person`);
  }
});

test('a path inside a recorded output folder matches only on a path boundary, after the path is made canonical', () => {
  const out = '/Workspace/Users/launcher@example.com/out/a';
  assert.equal(P.canonicalPath('/Workspace//Users/x/./out/../out/a/'), '/Users/x/out/a');
  assert.equal(P.canonicalPath('/Volumes/Main/Sales/Files/Report.PDF'), '/Volumes/main/sales/files/Report.PDF');
  assert.equal(P.canonicalPath('relative/path'), '');
  for (const path of [out, `${out}/b`, '/Users/launcher@example.com/out/a/b/../c', '/Workspace/Users/launcher@example.com//out/a']) {
    assert.equal(P.insideFolder(path, out), true, path);
  }
  for (const path of [`${out}b`, '/Workspace/Users/launcher@example.com/out', `${out}/../ab`, `${out}/../../out/a2`, 'Users/launcher@example.com/out/a', '']) {
    assert.equal(P.insideFolder(path, out), false, path);
  }
  assert.equal(P.insideFolder('/Shared/x', '/'), false, 'the root is never an output folder');
  assert.equal(P.insideFolder('/Shared/x', '/Workspace/Shared'), false, 'a top folder is never an output folder');
  assert.equal(P.insideFolder('/Volumes/main/s/v/run/x.csv', '/Volumes/MAIN/S/V/run'), true, 'volume names ignore case');
  assert.equal(P.insideFolder('/Volumes/main/s/v/RUN/x.csv', '/Volumes/main/s/v/run'), false, 'paths inside a volume keep their case');
  assert.equal(P.outputFolderOf('./../demos/', '/Shared/inspire-ai/dbx_inspire_ai_agent'), '/Shared/demos');
  assert.equal(P.outputFolderOf('./../demos/', ''), '');
  assert.equal(P.outputFolderOf('/Workspace/Users/a/out', ''), '/Users/a/out');
});

test('the artifact routes read with the App only inside a recorded output folder, and a failed folder read falls back to the person', async () => {
  const at = (path) => ({ query: { path } });
  const folders = async () => ['/Users/a/out'];
  const options = { appDatabase: 'main.inspire', outputFolders: folders };
  assert.equal(await P.resolveIdentity('GET /api/workspace/list', at('/Workspace/Users/a/out/x'), options), 'app');
  assert.equal(await P.resolveIdentity('GET /api/workspace/export', at('/Users/a/out/x/y.csv'), options), 'app');
  assert.equal(await P.resolveIdentity('GET /api/workspace/list', at('/Users/a/outside'), options), 'person');
  assert.equal(await P.resolveIdentity('GET /api/workspace/status', at('/Users/a/out/x'), options), 'person', 'status has no output exception');
  const broken = { appDatabase: 'main.inspire', outputFolders: async () => { throw new Error('warehouse stopped'); } };
  assert.equal(await P.resolveIdentity('GET /api/workspace/list', at('/Users/a/out/x'), broken), 'person');
  assert.equal(await P.resolveIdentity('GET /api/health', at('/Users/a/out/x'), options), 'app');
});

test('the person routes the owner setup wizard calls are covered by the App scope list', () => {
  const src = path.resolve(__dirname, '..', '..', 'frontend', 'src');
  const called = new Set();
  for (const rel of ['pages/SetupWizard.jsx', 'App.jsx']) {
    for (const m of fs.readFileSync(path.join(src, rel), 'utf8').matchAll(/fetch\(\s*[`'"](\/api\/[^`'"?$]*)/g)) called.add(m[1]);
  }
  const asKey = (p) => (p === '/api/catalogs' ? 'GET /api/catalogs' : p.startsWith('/api/catalogs/') ? 'GET /api/catalogs/:catalog/schemas' : `GET ${p}`);
  const wizardPerson = [...called].map(asKey).filter((key) => P.ROUTE_POLICY[key] && P.ROUTE_POLICY[key].identity === 'person').sort();
  assert.deepEqual(wizardPerson, ['GET /api/catalogs', 'GET /api/catalogs/:catalog/schemas', 'GET /api/warehouses']);
  for (const key of wizardPerson) for (const scope of P.ROUTE_POLICY[key].scopes) assert.ok(P.appUserScopes().includes(scope), `${key}: ${scope}`);
});
