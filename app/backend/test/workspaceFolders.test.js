const test = require('node:test');
const assert = require('node:assert/strict');
const { folderAnswer, folderModel } = require('./support/workspaceFolders');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { PROBE_PREFIX } = require('../lib/ucReads');

const PERSON = 'person-token';
const EMAIL = ['pat', 'example.com'].join('@');
const NOTEBOOK = '/Shared/inspire/dbx_inspire_ai_agent';
const ask = (method, path, body, token = PERSON) => {
  const url = new URL(`http://x${path}`);
  return { method, pathname: url.pathname, searchParams: url.searchParams, body, token };
};
const byToken = (model) => (parent, token) => {
  const grant = (model.folders[parent] || {}).writers;
  return grant === '*' || (Array.isArray(grant) && grant.includes(token));
};

test('the shared fake workspace answers the output folder write check the way a workspace does, allowed and refused', () => {
  const model = folderModel({ folders: { '/Shared': { writers: '*' }, '/Users/pat': { writers: [PERSON] } } });
  const answer = (...args) => folderAnswer(model, ask(...args), byToken(model));
  assert.deepEqual(answer('GET', '/api/2.0/workspace/get-status?path=%2FShared%2Fdemos'), [404, { error_code: 'RESOURCE_DOES_NOT_EXIST', message: '/Shared/demos does not exist' }]);
  assert.equal(answer('GET', '/api/2.0/workspace/get-status?path=%2FShared')[1].object_type, 'DIRECTORY');
  assert.equal(answer('GET', '/api/2.0/workspace/get-status?path=%2F')[1].object_type, 'DIRECTORY');
  assert.deepEqual(answer('POST', '/api/2.0/workspace/mkdirs', { path: '/Shared/probe1' }), [200, {}]);
  assert.deepEqual(answer('GET', '/api/2.0/workspace/list?path=%2FShared')[1].objects, [{ path: '/Shared/probe1', object_type: 'DIRECTORY' }]);
  assert.deepEqual(answer('POST', '/api/2.0/workspace/delete', { path: '/Shared/probe1' }), [200, {}]);
  assert.deepEqual([model.created, model.deleted], [[], ['/Shared/probe1']]);
  assert.deepEqual(answer('POST', '/api/2.0/workspace/mkdirs', { path: '/Users/pat/probe2' }), [200, {}]);
  assert.deepEqual(answer('POST', '/api/2.0/workspace/mkdirs', { path: '/Users/pat/probe3' }, 'someone-else'),
    [403, { error_code: 'PERMISSION_DENIED', message: 'no permission to create /Users/pat/probe3' }]);
  assert.deepEqual(model.created, ['/Users/pat/probe2'], 'a refused create makes nothing');
  assert.equal(answer('GET', '/api/2.1/jobs/get?job_id=1'), null, 'a call that is not about folders is left to the test');
});

function launchAnswer(call) {
  const url = new URL(`http://x${call.path}`);
  if (call.path === '/oidc/v1/token') return [200, { access_token: 'sp-token', expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: EMAIL }];
  if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: 'main.s.orders' }];
  if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === NOTEBOOK) return [200, { object_type: 'NOTEBOOK', path: NOTEBOOK }];
  if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
  if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
  return null;
}

async function launchOn(folders) {
  const workspace = await fakeWorkspace(launchAnswer, folders ? { folders } : {});
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: NOTEBOOK, NODE_ENV: 'production',
      DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' });
    const resp = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': PERSON, 'x-forwarded-email': EMAIL },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders' } }),
    });
    return { status: resp.status, data: await resp.json(), workspace };
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('a run launched against the shared fake workspace passes the write check where the person can write, and is refused where not', async () => {
  const allowed = await launchOn();
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  const probes = allowed.workspace.calls.filter((c) => c.path === '/api/2.0/workspace/mkdirs');
  const mine = probes.filter((c) => c.token === PERSON);
  assert.equal(mine.length, 1, 'one probe with the person\u2019s own token');
  assert.ok(probes.every((c) => c.token === PERSON || c === probes.find((p) => p.token !== PERSON)), 'at most one more, the App checking the folder it writes to');
  assert.match(mine[0].body.path, new RegExp(`^/Shared/${PROBE_PREFIX}`));
  assert.deepEqual(allowed.workspace.model.created, [], 'every probe is deleted again');
  assert.ok(allowed.workspace.model.deleted.includes(mine[0].body.path));
  assert.equal(allowed.workspace.calls.filter((c) => c.path === '/api/2.1/jobs/create').length, 1);

  const refused = await launchOn({ '/Shared': { writers: ['someone-else'] } });
  assert.equal(refused.status, 403, JSON.stringify(refused.data));
  assert.deepEqual(refused.data.unwritable, ['/Shared/demos']);
  assert.match(refused.data.error, /^You cannot write to \/Shared\/demos \(you cannot create anything in \/Shared\) with your own sign-in/);
  assert.deepEqual(refused.workspace.model.created, []);
  assert.equal(refused.workspace.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/')).length, 0, 'no job is created');
});
