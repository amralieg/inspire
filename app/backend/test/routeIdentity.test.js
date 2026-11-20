const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/routePolicy');

// unity-catalog: the Request for Access API page names it ("API scopes: unity-catalog") (REQ-311).
const DOCUMENTED_USER_SCOPES = ['ai-functions', 'ai-gateway', 'apps', 'files', 'genie', 'model-serving', 'postgres', 'sql', 'unity-catalog', 'vector-search',
  'sql:restricted-query', 'iam.access-control:read', 'iam.current-user:read',
  ...['catalog.catalogs', 'catalog.connections', 'catalog.schemas', 'catalog.tables', 'workspace.workspace'].flatMap((s) => [s, `${s}:read`])];
const personRoutes = () => Object.entries(P.ROUTE_POLICY).filter(([, e]) => e.identity === 'person');
const scopedRoutes = () => Object.entries(P.ROUTE_POLICY).filter(([, e]) => e.identity === 'person' || e.outputWrite === true);

// REQ-418 / D-SL-10B: a route reads with the App's service principal unless it is a who-did-what action of the person.
test('data routes read with the App, and only who-did-what routes keep the person token; an unknown route keeps the person (fail before: the data routes read as the person)', () => {
  for (const key of ['GET /api/workspace/list', 'GET /api/catalogs', 'GET /api/catalogs/:catalog/schemas', 'GET /api/tables/:catalog/:schema',
    'GET /api/inspire/implement/values', 'POST /api/run/check', 'POST /api/output-folder/check', 'POST /api/inspire/samples/copy']) {
    assert.equal(P.identityFor(key), 'app', key);
  }
  assert.equal(P.identityFor('GET /api/health'), 'app');
  assert.equal(P.identityFor('POST /api/setup/create-database'), 'app');
  for (const key of ['POST /api/access-request', 'POST /api/access-request/check', 'POST /api/inspire/implement/grant-access']) {
    assert.equal(P.identityFor(key), 'person', key);
  }
  // Ruling 3 (REQ-418): create-schema runs as the App; the signed-in person is recorded as the requester in Inspire's own records.
  assert.equal(P.identityFor('POST /api/inspire/implement/create-schema'), 'app');
  assert.equal(P.identityFor('GET /api/not-declared'), 'person');
  assert.equal(P.identityFor(undefined), 'person');
});

test('a tracking route reads with the App in every database, the one it was installed with or another (REQ-418: the person never reads for it)', () => {
  assert.equal(P.identityFor('GET /api/inspire/sessions'), 'app');
  assert.equal(P.identityFor('POST /api/inspire/feedback'), 'app');
});

test('the refusal for a person route with no sign-in names the route and the fix, and carries no token', () => {
  const body = P.noPersonTokenBody('POST /api/access-request');
  assert.equal(body.error, P.NO_PERSON_TOKEN);
  assert.match(body.error, /your own sign-in/);
  assert.match(body.error, /re-run the Inspire installer/);
  assert.deepEqual(body.policy, { route: 'POST /api/access-request', identity: 'person', needs: P.IDENTITIES.person });
});

test('the App user scopes are the who-did-what scopes: the manager check, a Request for Access, a grant or a schema the person makes, and the own-folder share', () => {
  const scopes = P.appUserScopes();
  assert.deepEqual(scopes, ['apps', 'catalog.catalogs:read', 'sql', 'workspace.workspace']);
  assert.deepEqual(scopes.filter((s) => !DOCUMENTED_USER_SCOPES.includes(s)), [], 'not a documented Databricks Apps user scope');
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

test('only the own-folder check writes with the person (the App writes the output itself), and the person routes are the who-did-what actions', () => {
  const writers = scopedRoutes().filter(([, e]) => e.outputWrite === true).map(([key]) => key).sort();
  assert.deepEqual(writers, ['POST /api/output-folder/check'], 'the one person route that shares the person\'s own folder with the App');
  assert.deepEqual(P.ROUTE_POLICY['POST /api/output-folder/check'].scopes, P.OUTPUT_WRITE_SCOPES);
  assert.deepEqual(personRoutes().map(([key]) => key).sort(), ['POST /api/access-request', 'POST /api/access-request/check',
    'POST /api/inspire/implement/grant-access']);
});

test('a path inside a recorded output folder matches only on a path boundary, after the path is made canonical', () => {
  assert.equal(P.canonicalPath('/Workspace//Users/x/./out/../out/a/'), '/Users/x/out/a');
  assert.equal(P.canonicalPath('/Volumes/Main/Sales/Files/Report.PDF'), '/Volumes/main/sales/files/Report.PDF');
  assert.equal(P.canonicalPath('relative/path'), '');
  assert.equal(P.outputFolderOf('./../demos/', '/Shared/inspire-ai/dbx_inspire_ai_agent'), '/Shared/demos');
  assert.equal(P.outputFolderOf('./../demos/', ''), '');
  assert.equal(P.outputFolderOf('/Workspace/Users/a/out', ''), '/Users/a/out');
});

test('the person routes the owner setup wizard calls are covered by the App scope list, and the wizard reads no data as the person', () => {
  const src = path.resolve(__dirname, '..', '..', 'frontend', 'src');
  const called = new Set();
  for (const rel of ['pages/SetupWizard.jsx', 'App.jsx']) {
    for (const m of fs.readFileSync(path.join(src, rel), 'utf8').matchAll(/(?:fetch|bootRead)\(\s*[`'"](\/api\/[^`'"?$]*)/g)) called.add(m[1]);
  }
  const asKey = (p) => (p === '/api/catalogs' ? 'GET /api/catalogs' : p.startsWith('/api/catalogs/') ? 'GET /api/catalogs/:catalog/schemas' : `GET ${p}`);
  const wizardPerson = [...called].map(asKey).filter((key) => P.ROUTE_POLICY[key] && P.ROUTE_POLICY[key].identity === 'person').sort();
  assert.deepEqual(wizardPerson, [], 'the picker reads are App reads now (REQ-418)');
});
