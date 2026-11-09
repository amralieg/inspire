const test = require('node:test');
const assert = require('node:assert/strict');
const { folderAnswer, folderModel } = require('./support/workspaceFolders');
const W = require('../lib/ucReads');

const ME = 'pat@example.com';
const HOME = `/Users/${ME}`;
const OWN = `${HOME}/inspire_output`;
const PERSON = 'person-token';
const APP = 'app-token';
const APP_ID = 'app-sp-0001';
const DEFAULTED = { folders: ['/Shared/demos'], defaulted: true };
const SHARED_SENTENCE = `Inspire cannot save to your own folder ${OWN}, so it saves to /Shared/demos, a shared folder that everyone in the workspace can open.`;
const SCOPE_SENTENCE = `Inspire cannot save to your own folder ${OWN}, because this App may not use your sign-in for workspace folders (run the Inspire installer again to allow it), so it saves to /Shared/demos, a shared folder that everyone in the workspace can open.`;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function workspace(folders, overrides = {}) {
  const model = folderModel({ folders, ...overrides });
  const calls = [];
  const writable = (path, token) => {
    const grant = (model.folders[path] || {}).writers;
    const who = token === APP ? APP_ID : token === PERSON ? ME : '';
    return grant === '*' || (Array.isArray(grant) && grant.includes(who));
  };
  const dbFetch = async (host, token, path, options = {}) => {
    const url = new URL(`${host}${path}`);
    const method = String(options.method || 'GET').toUpperCase();
    let body = {};
    try { body = options.body ? JSON.parse(options.body) : {}; } catch { body = {}; }
    calls.push({ method, path: url.pathname, query: url.search, token, body });
    if (overrides.scopeFor && overrides.scopeFor(url.pathname, token)) {
      return response(403, { error_code: 403, message: `Provided OAuth token does not have required scopes: ${overrides.scopeFor(url.pathname, token)}` });
    }
    const [status, data] = folderAnswer(model, { method, pathname: url.pathname, searchParams: url.searchParams, body, token }, writable)
      || [404, { error_code: 'NOT_FOUND', message: `not mocked ${method} ${url.pathname}` }];
    return response(status, data);
  };
  return { model, calls, dbFetch };
}

const response = (status, data) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data), json: async () => data });
const request = (person = ME, token = PERSON) => ({ dbHost: 'https://ws.example', headers: { ...(person ? { 'x-forwarded-email': person } : {}), ...(token ? { 'x-forwarded-access-token': token } : {}) } });
const plan = (ws, writes = DEFAULTED, options = {}, req = request()) => W.outputPlan(ws.dbFetch, req, writes, { manager: true, appToken: APP, appId: APP_ID, ...options });
const permissionCalls = (ws) => ws.calls.filter((c) => c.path.startsWith('/api/2.0/permissions/'));
const SHARED_OPEN = { '/Shared': { id: 2, writers: '*' }, '/Shared/demos': { id: 7, writers: '*' } };

test('an App manager with an empty Generation Path gets their own folder: Inspire creates it with their sign-in, gives the App CAN MANAGE on it alone, and says nothing', async () => {
  for (const [label, folders] of [
    ['the folder does not exist yet', { ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } }],
    ['the folder exists and the App cannot write it', { ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] }, [OWN]: { id: 13, writers: [ME] } }],
  ]) {
    const ws = workspace(folders);
    const got = await plan(ws);
    assert.deepEqual([got.refused, got.folder, got.generationPath, got.warnings, got.details], [null, OWN, `/Workspace${OWN}`, [], []], label);
    assert.ok(ws.model.folders[OWN], `${label}: the folder exists now`);
    const id = ws.model.folders[OWN].id;
    assert.deepEqual(ws.model.grants, [{ path: OWN, token: PERSON, entries: [{ service_principal_name: APP_ID, permission_level: 'CAN_MANAGE' }] }], `${label}: one grant`);
    const patches = permissionCalls(ws);
    assert.deepEqual(patches.map((c) => [c.method, c.path, c.token]), [['PATCH', `/api/2.0/permissions/directories/${id}`, PERSON]], `${label}: PATCH adds, never PUT, with the person token`);
    const mkdirs = ws.calls.filter((c) => c.path === '/api/2.0/workspace/mkdirs' && c.body.path === OWN);
    assert.deepEqual(mkdirs.map((c) => c.token), [PERSON], `${label}: the folder is made with the person sign-in`);
    assert.ok(ws.calls.some((c) => c.token === APP && c.path === '/api/2.0/workspace/mkdirs' && c.body.path.startsWith(`${OWN}/${W.PROBE_PREFIX}`)),
      `${label}: the App write is checked again, inside the shared folder`);
    assert.ok(!ws.calls.some((c) => c.query.includes(encodeURIComponent('/Shared/demos')) || c.body.path === '/Shared/demos'), `${label}: the shared folder is never touched`);
  }
});

test('a person who is not a manager gets the same: their own write is checked, then their folder is shared with the App', async () => {
  const ws = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } });
  const got = await plan(ws, DEFAULTED, { manager: false });
  assert.deepEqual([got.folder, got.warnings, got.details], [OWN, [], []]);
  assert.equal(ws.model.grants.length, 1);
});

test('an own folder the App can already write is used as is, with no folder made and no grant (must-exclude)', async () => {
  const ws = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME, APP_ID] } });
  const got = await plan(ws);
  assert.deepEqual([got.folder, got.warnings], [OWN, []]);
  assert.deepEqual(permissionCalls(ws), [], 'no permission call when the App can write already');
  assert.equal(ws.model.folders[OWN], undefined, 'no folder made before the run needs it');
});

test('a grant Databricks refuses falls back to the shared folder with one plain sentence, and the exact grant and the refusal go under Details', async () => {
  const ws = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } }, { permissionsRefused: 'workspace object ACLs are locked by an admin' });
  const got = await plan(ws);
  assert.deepEqual([got.refused, got.folder, got.generationPath, got.warnings], [null, '/Shared/demos', '/Workspace/Shared/demos', [SHARED_SENTENCE]]);
  const id = ws.model.folders[OWN].id;
  assert.deepEqual(got.details, [`PATCH /api/2.0/permissions/directories/${id} {"access_control_list":[{"service_principal_name":"${APP_ID}","permission_level":"CAN_MANAGE"}]} `
    + 'answered HTTP 403: workspace object ACLs are locked by an admin']);
  assert.doesNotMatch(got.warnings[0], /\/api\/|CAN_MANAGE|HTTP|service principal/, 'the sentence holds no technical text');
  assert.equal(got.warnings.length, 1, 'one sentence, nothing else');
});

test('a sign-in whose scopes do not cover workspace permissions falls back the same way, and names the scope answer under Details', async () => {
  const ws = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } },
    { scopeFor: (path, token) => (token === PERSON && path.startsWith('/api/2.0/permissions/') ? 'workspace' : '') });
  const got = await plan(ws);
  assert.deepEqual([got.folder, got.warnings], ['/Shared/demos', [SCOPE_SENTENCE]]);
  assert.equal(got.details.length, 1);
  assert.match(got.details[0], /^PATCH \/api\/2\.0\/permissions\/directories\/\d+ \{"access_control_list":\[\{"service_principal_name":"app-sp-0001","permission_level":"CAN_MANAGE"\}\]\} answered HTTP 403: Provided OAuth token does not have required scopes: workspace$/);
  const noWorkspaceScope = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } },
    { scopeFor: (path, token) => (token === PERSON && path === '/api/2.0/workspace/mkdirs' ? 'workspace' : '') });
  const early = await plan(noWorkspaceScope);
  assert.deepEqual([early.folder, early.warnings], ['/Shared/demos', [SCOPE_SENTENCE]]);
  assert.match(early.details[0], new RegExp(`^POST /api/2\\.0/workspace/mkdirs ${OWN} answered HTTP 403: Provided OAuth token does not have required scopes: workspace$`));
  assert.match(early.details[1], /^PATCH \/api\/2\.0\/permissions\/directories\/<folder id> /, 'the exact grant to ask for is still named');
  assert.deepEqual(permissionCalls(noWorkspaceScope), [], 'no grant tried on a folder that could not be made');
});

test('no App service principal or no forwarded sign-in shares nothing and falls back with the reason under Details', async () => {
  const folders = { ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } };
  const nobody = workspace(folders);
  const got = await plan(nobody, DEFAULTED, { appId: '' });
  assert.deepEqual([got.folder, got.warnings], ['/Shared/demos', [SHARED_SENTENCE]]);
  assert.match(got.details[0], /it knows no App service principal to share with$/);
  assert.deepEqual(permissionCalls(nobody), []);
  assert.equal(nobody.model.folders[OWN], undefined);
});

test('Inspire never grants on the shared folder, a typed folder, or any folder other than the person\u2019s own inspire_output (must-exclude)', async () => {
  const folders = { ...SHARED_OPEN, '/Shared/team': { id: 20, writers: [ME] }, [HOME]: { id: 12, writers: [ME] }, [`${HOME}/other`]: { id: 21, writers: [ME] } };
  for (const [label, writes, told] of [
    ['a typed shared folder', { folders: ['/Shared/team/out'], defaulted: false }, 1],
    ['a typed folder in the person home', { folders: [`${HOME}/other`], defaulted: false }, 1],
    ['the shared default typed out', { folders: ['/Shared/demos'], defaulted: false }, 0],
    ['a typed path that names the own folder', { folders: [OWN], defaulted: false }, 1],
  ]) {
    const ws = workspace(JSON.parse(JSON.stringify(folders)));
    const got = await plan(ws, writes);
    assert.deepEqual(permissionCalls(ws), [], `${label}: no permission call`);
    assert.deepEqual(ws.model.grants, [], label);
    assert.equal(got.warnings.length, told, `${label}: a typed folder the App cannot write is named to the person, and nothing is changed for them`);
  }
  for (const [label, person] of [['a forwarded name with a slash', 'pat/../../Shared'], ['a dot name', '..'], ['no forwarded name', '']]) {
    const ws = workspace(JSON.parse(JSON.stringify(folders)));
    await plan(ws, DEFAULTED, {}, request(person));
    assert.deepEqual(permissionCalls(ws), [], `${label}: no permission call`);
    assert.ok(!ws.calls.some((c) => c.path === '/api/2.0/workspace/mkdirs' && !String(c.body.path).includes(W.PROBE_PREFIX)), `${label}: no folder made`);
  }
  const ws = workspace(JSON.parse(JSON.stringify(folders)));
  await plan(ws);
  assert.deepEqual(ws.model.grants.map((g) => g.path), [OWN], 'the one grant is on the person\u2019s own inspire_output, nothing else');
});

test('a grant that lands while the App still cannot write keeps the shared fallback and says so under Details', async () => {
  const ws = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } });
  const real = ws.dbFetch;
  ws.dbFetch = async (host, token, path, options) => {
    const got = await real(host, token, path, options);
    if (path.startsWith('/api/2.0/permissions/directories/')) ws.model.folders[OWN].writers = [ME];
    return got;
  };
  const got = await plan(ws);
  assert.deepEqual([got.folder, got.warnings], ['/Shared/demos', [SHARED_SENTENCE]]);
  assert.match(got.details[0], /^PATCH \/api\/2\.0\/permissions\/directories\/\d+ .* succeeded, and the App still cannot write there: you cannot create anything in /);
});

test('the shared fake workspace answers directory permissions like the live workspace: PATCH adds for a manager of the folder and refuses anyone else', () => {
  const model = folderModel({ folders: { [HOME]: { id: 12, writers: [ME] } } });
  const writable = (path, token) => (model.folders[path] || {}).writers.includes(token);
  const ask = (method, path, body, token) => folderAnswer(model, { method, pathname: path, searchParams: new URLSearchParams(), body, token }, writable);
  const acl = { access_control_list: [{ service_principal_name: APP_ID, permission_level: 'CAN_MANAGE' }] };
  assert.equal(ask('PATCH', '/api/2.0/permissions/directories/12', acl, 'someone-else')[0], 403, 'no CAN MANAGE on the folder, no grant');
  assert.deepEqual(model.folders[HOME].writers, [ME]);
  assert.equal(ask('PATCH', '/api/2.0/permissions/directories/12', acl, ME)[0], 200);
  assert.deepEqual(model.folders[HOME].writers, [ME, APP_ID]);
  assert.equal(ask('GET', '/api/2.0/permissions/directories/12', undefined, ME)[1].access_control_list.length, 2);
  assert.equal(ask('PATCH', '/api/2.0/permissions/directories/999', acl, ME)[0], 404);
  assert.equal(ask('PUT', '/api/2.0/permissions/directories/12', acl, ME)[0], 405, 'a PUT would replace the folder ACL, and Inspire never sends one');
});

test('loading Start only reads: the check names the own folder when the person can share it, and makes no folder, no grant and no write call (must-exclude)', async () => {
  for (const [label, folders] of [
    ['the folder does not exist yet', { ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } }],
    ['the folder exists', { ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] }, [OWN]: { id: 13, writers: [ME] } }],
  ]) {
    const ws = workspace(folders);
    const got = await plan(ws, DEFAULTED, { preview: true, manager: false });
    assert.deepEqual([got.refused, got.folder, got.generationPath, got.warnings, got.details], [null, OWN, `/Workspace${OWN}`, [], []], label);
    assert.deepEqual(ws.calls.filter((c) => WRITES.has(c.method)), [], `${label}: no write call of any kind`);
    assert.deepEqual(ws.model.grants, [], label);
    assert.equal(Boolean(ws.model.folders[OWN]), label === 'the folder exists', `${label}: no folder made`);
    assert.deepEqual(permissionCalls(ws).map((c) => [c.method, c.token]), [['GET', PERSON]], `${label}: the person sign-in reads the folder permissions once`);
    const started = await plan(ws, DEFAULTED, { manager: false });
    assert.deepEqual([started.folder, started.warnings], [OWN, []], `${label}: starting the run makes and shares it`);
    assert.deepEqual(ws.model.grants.map((g) => g.path), [OWN], label);
  }
});

test('loading Start says the run falls back, and why, when the sign-in cannot read the folder permissions, still without any write call', async () => {
  const scoped = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } },
    { scopeFor: (path, token) => (token === PERSON && path.startsWith('/api/2.0/permissions/') ? 'workspace' : '') });
  const got = await plan(scoped, DEFAULTED, { preview: true });
  assert.deepEqual([got.folder, got.generationPath, got.warnings], ['/Shared/demos', '/Workspace/Shared/demos', [SCOPE_SENTENCE]]);
  assert.match(got.details[0], /^GET \/api\/2\.0\/permissions\/directories\/12 answered HTTP 403: Provided OAuth token does not have required scopes: workspace$/);
  assert.match(got.details[1], /^PATCH \/api\/2\.0\/permissions\/directories\/<folder id> /);
  const locked = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: ['someone@example.com'] } });
  const theirs = await plan(locked, DEFAULTED, { preview: true });
  assert.deepEqual([theirs.folder, theirs.warnings], ['/Shared/demos', [SHARED_SENTENCE]]);
  const unsigned = workspace({ ...SHARED_OPEN, [HOME]: { id: 12, writers: [ME] } });
  const none = await plan(unsigned, DEFAULTED, { preview: true }, request(ME, ''));
  assert.equal(none.refused.status, 401);
  for (const ws of [scoped, locked, unsigned]) assert.deepEqual(ws.calls.filter((c) => WRITES.has(c.method)), []);
});
