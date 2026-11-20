// REQ-424 / D-UGW-4A: the App checks itself. For each setup in support/modelAccessWorlds.json the recorded self-check result
// (blocked, callable, setup, steps) equals what the fixture expects, and the route the installer reads serves that record.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planModelAccess, selfCheckRecord, MODEL_CHECK_ROUTE } = require('../lib/modelAccess');
const WORLDS = require('./support/modelAccessWorlds.json');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const PRINCIPAL = '11111111-2222-3333-4444-555555555555';
const STATUS = { answer: 200, enforced: 403, denied: 403, ratelimit: 429, missing: 404 };

function answerFor(world, name) {
  const outcome = world.outcomes[name] || 'missing';
  if (outcome === 'answer') return { ok: true, status: 200, data: { choices: [{ message: { content: 'OK' } }] } };
  return { ok: false, status: STATUS[outcome], data: { message: WORLDS.texts[outcome].replace('{name}', name) } };
}

function callFor(world) {
  return async (method, path, body) => {
    if (method === 'GET' && path === '/api/2.0/serving-endpoints') {
      if (world.listing !== 'answer') return { ok: false, status: STATUS[world.listing], data: { message: WORLDS.texts[world.listing].replace('{name}', 'the serving endpoints') } };
      return { ok: true, status: 200, data: { endpoints: world.endpoints } };
    }
    if (method === 'GET' && path === '/ai-gateway/codex/v1/models') {
      if (world.gateway !== 'answer') return { ok: false, status: STATUS[world.gateway], data: { message: WORLDS.texts[world.gateway].replace('{name}', 'the gateway') } };
      return { ok: true, status: 200, data: { models: world.gateway_models.map((slug) => ({ slug })) } };
    }
    const endpoint = /^\/serving-endpoints\/(.+)\/invocations$/.exec(path);
    if (method === 'POST' && endpoint) return answerFor(world, decodeURIComponent(endpoint[1]));
    if (method === 'POST' && path === '/ai-gateway/mlflow/v1/chat/completions') return answerFor(world, body.model);
    throw new Error(`unexpected call ${method} ${path}`);
  };
}

for (const world of WORLDS.worlds) {
  test(`self-check record for setup ${world.setup} (${world.id}) equals the fixture's blocked, callable and steps`, async () => {
    const record = selfCheckRecord(await planModelAccess({ call: callFor(world), principal: PRINCIPAL }), PRINCIPAL);
    assert.equal(record.state, 'checked');
    assert.equal(record.blocked, world.expected.blocked, JSON.stringify(record));
    assert.equal(record.callable, world.expected.callable, JSON.stringify(record));
    assert.equal(record.setup, world.setup, JSON.stringify(record));
    assert.deepEqual(record.steps, world.expected.steps.map((s) => s.replace('<principal>', PRINCIPAL)));
  });
}

test('the route contract in the fixture is the route the real handler serves, with the record under its field', async () => {
  S.reset({ notebookPresent: true, modelDenied: true });
  const check = await S.request('POST', '/api/run/check', { body: { params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7101' } } });
  assert.equal(check.status, 200, check.text);
  const got = await S.request('GET', WORLDS.route.path);
  assert.equal(WORLDS.route.path, MODEL_CHECK_ROUTE.path);
  assert.equal(WORLDS.route.field, MODEL_CHECK_ROUTE.field);
  const record = got.data[WORLDS.route.field];
  assert.deepEqual(Object.keys(record).sort(), [...WORLDS.route.keys].sort(), JSON.stringify(record));
  assert.equal(record.state, 'checked');
  assert.equal(record.blocked, true);
  assert.equal(record.setup, 'denied');
  assert.deepEqual(record.steps, WORLDS.worlds.find((w) => w.id === 'sp-denied').expected.steps.map((s) => s.replace('<principal>', S.APP_SP)));
});

test('Start re-checks before each run: the record follows the workspace (blocked, then fine, then rate limited)', async () => {
  const params = { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7101' };
  const record = async () => (await S.request('GET', WORLDS.route.path)).data[WORLDS.route.field];
  S.reset({ notebookPresent: true, modelDenied: true });
  assert.equal((await S.request('POST', '/api/run/check', { body: { params } })).status, 200);
  assert.equal((await record()).blocked, true);
  S.reset({ notebookPresent: true, modelDenied: false });
  assert.equal((await S.request('POST', '/api/run/check', { body: { params } })).status, 200);
  const fine = await record();
  assert.equal(fine.blocked, false);
  assert.equal(fine.callable, 'databricks-claude-sonnet-4-6');
  S.reset({ notebookPresent: true, modelRateLimited: true });
  const limited = await S.request('POST', '/api/run', { body: { params, notebook_path: '/Shared/inspire-test-app/dbx_inspire_ai_agent' } });
  assert.equal(limited.status, 200, `a rate limit never blocks a run: ${limited.text}`);
  const after = await record();
  assert.equal(after.blocked, false);
  assert.equal(after.setup, 'rate limit');
});

test('the Start page block carries the same steps text as the record (instructions of the Permission Required entry)', async () => {
  S.reset({ notebookPresent: true, modelDenied: true });
  const got = await S.request('POST', '/api/run/check', { body: { params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7101' } } });
  const entry = got.data.permissions.find((p) => p.instructions.length);
  const record = (await S.request('GET', WORLDS.route.path)).data[WORLDS.route.field];
  assert.deepEqual(entry.instructions, record.steps);
});
