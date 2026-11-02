const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON_TOKEN = 'person-token';
const SP = { userName: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d', displayName: 'app-q7k2m9 inspire-ai', applicationId: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d' };
const PERSON = ['pat.lee', 'example.com'].join('@');
const ONLY_SP = 'this request names no signed-in person, only the App\u2019s own service principal';

const done = (columns = [], rows = []) => [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) } }, result: { data_array: rows } }];

function answer(call) {
  if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) {
    if (call.token === SP_TOKEN) return [200, SP];
    if (call.token === PERSON_TOKEN) return [200, { userName: PERSON, displayName: 'Pat Lee' }];
    return [401, { detail: 'Invalid access token' }];
  }
  if (call.path === '/api/2.0/sql/statements' && call.method === 'POST') {
    return String(call.body && call.body.statement).startsWith('SELECT business_name') ? done(['business_name'], [['Acme']]) : done();
  }
  return null;
}

async function withInspire(env, run) {
  const workspace = await fakeWorkspace(answer);
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, ...env });
    await run(inspire.url, workspace);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

async function me(url, headers = {}) {
  const resp = await fetch(`${url}/api/me`, { headers });
  return { status: resp.status, data: await resp.json() };
}

const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_DATABASE: 'main.inspire' };

test('on a Databricks App backed by its service principal, /api/me names the signed-in person from the forwarded headers, never the service principal', async () => {
  await withInspire(APP_ENV, async (url, workspace) => {
    const headers = { 'x-forwarded-access-token': PERSON_TOKEN, 'x-forwarded-email': PERSON, 'x-forwarded-preferred-username': PERSON, 'x-forwarded-user': 'pat-user' };
    const named = await me(url, headers);
    assert.deepEqual([named.status, named.data.person], [200, { username: PERSON, displayName: PERSON, source: 'proxy' }]);
    assert.deepEqual(named.data.app, { username: SP.userName, displayName: SP.displayName, about: 'the identity the Inspire App uses to call Databricks' },
      'the App is named apart from the person');
    const preferred = await me(url, { 'x-forwarded-preferred-username': PERSON });
    assert.deepEqual([preferred.status, preferred.data.person], [200, { username: PERSON, displayName: PERSON, source: 'proxy' }],
      'the preferred user name alone names the person');
    const byToken = await me(url, { 'x-forwarded-access-token': PERSON_TOKEN });
    assert.deepEqual([byToken.status, byToken.data.person], [200, { username: PERSON, displayName: 'Pat Lee', source: 'proxy' }],
      'the forwarded token alone names the person through SCIM');
    const scim = workspace.calls.filter((c) => c.path.startsWith('/api/2.0/preview/scim/v2/Me') && c.token !== SP_TOKEN);
    assert.deepEqual(scim.map((c) => c.token), [PERSON_TOKEN], 'only the person\u2019s own token asks SCIM who the person is');
  });
});

test('on a Databricks App with no forwarded person, /api/me says only the service principal is known and names no person', async () => {
  await withInspire(APP_ENV, async (url) => {
    assert.deepEqual(await me(url), {
      status: 401,
      data: { error: 'The Databricks Apps proxy sent no signed-in person, so Inspire cannot tell who you are.' },
    });
    assert.match(ONLY_SP, /signed-in person/);
  });
});

test('feedback records the person the forwarded headers name, also when only the preferred user name is forwarded', async () => {
  await withInspire(APP_ENV, async (url, workspace) => {
    const resp = await fetch(`${url}/api/inspire/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-preferred-username': PERSON },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', status: 'accepted', use_case_key: 'churn|main.s.orders' }),
    });
    assert.equal(resp.status, 200, await resp.text());
    const insert = workspace.calls.find((c) => c.path === '/api/2.0/sql/statements' && String(c.body.statement).startsWith('INSERT INTO'));
    assert.equal(insert.body.parameters.find((p) => p.name === 'updated_by').value, PERSON);
    assert.ok(workspace.calls.filter((c) => c.path === '/api/2.0/sql/statements').every((c) => c.token === SP_TOKEN), 'the SQL still runs as the App');
  });
});

test('with a personal access token and no forwarded person, /api/me keeps naming the token\u2019s owner and says it came from the request token', async () => {
  await withInspire({ NODE_ENV: 'development', DATABRICKS_TOKEN: PERSON_TOKEN }, async (url) => {
    const got = await me(url);
    assert.deepEqual([got.status, got.data.person], [200, { username: PERSON, displayName: 'Pat Lee', source: 'token' }]);
  });
  await withInspire({ NODE_ENV: 'development', DATABRICKS_TOKEN: 'not-a-token' }, async (url) => {
    assert.deepEqual(await me(url), { status: 401, data: { error: 'Invalid access token', source: 'token' } });
  });
});
