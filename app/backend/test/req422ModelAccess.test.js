// REQ-422: under Enforce Unity Gateway the Databricks-provided pay-per-token endpoints (databricks-<model>) are refused with
// "is disabled for this workspace ... Please use Unity Gateway". The model service system.ai.<model> is the route that works:
// the Unity Gateway chat route (/ai-gateway/mlflow/v1/chat/completions) with model = system.ai.<model>. The permission the App
// raises names the grants on that service, never "turn on pay-per-token" (cited in the REQ-422 commit and report).
const test = require('node:test');
const assert = require('node:assert/strict');
const { modelAccessPermission, invokeChatModel, GATEWAY_CHAT } = require('../lib/modelAccess');

const PRINCIPAL = '11111111-2222-3333-4444-555555555555';
const SONNET = 'databricks-claude-sonnet-4-6';
const chat = (name, id) => ({ name, id, task: 'llm/v1/chat', state: { ready: 'READY' } });
const invocations = (name) => `/serving-endpoints/${name}/invocations`;
const ENFORCED = { message: `Querying pay-per-token foundation model endpoint '${SONNET}' is disabled for this workspace. Please use Unity Gateway.` };

// Fake of the REST calls. `probes` maps a path to { status, data }; unlisted paths answer 200.
function fake({ endpoints = [], probes = {}, gateway = { ok: false, status: 404, data: {} } } = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path === '/api/2.0/serving-endpoints') return { ok: true, status: 200, data: { endpoints } };
    if (method === 'GET' && path === '/ai-gateway/codex/v1/models') return gateway;
    const hit = probes[path];
    const status = hit ? hit.status : 200;
    return { ok: status === 200, status, data: hit ? hit.data || {} : {} };
  };
  return { call, calls, chatCalls: () => calls.filter((c) => c.path === GATEWAY_CHAT) };
}

test('under enforcement the refused pay-per-token name is retried on its system.ai model service, and a working service lets the run start', async () => {
  // Fail-pre: the App stopped at the refusal and never called the model service.
  const { call, chatCalls } = fake({
    endpoints: [chat(SONNET, undefined)],
    probes: { [invocations(SONNET)]: { status: 403, data: ENFORCED } },
  });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null, 'the model service answers, so nothing is blocked');
  assert.equal(chatCalls().length, 1);
  assert.equal(chatCalls()[0].body.model, 'system.ai.claude-sonnet-4-6', 'the model service is named by its three-level name');
});

test('under enforcement with the model service also refused, the permission names EXECUTE and the two usage grants, not pay-per-token', async () => {
  // Fail-pre: the steps had no USE CATALOG or USE SCHEMA, and the why did not say the pay-per-token endpoint is disabled.
  const { call } = fake({
    endpoints: [chat(SONNET, undefined)],
    probes: {
      [invocations(SONNET)]: { status: 403, data: ENFORCED },
      [GATEWAY_CHAT]: { status: 403, data: { message: 'PERMISSION_DENIED' } },
    },
  });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission, 'every route refused, so a permission is raised');
  const steps = permission.steps.join('\n');
  assert.ok(steps.includes('system.ai.claude-sonnet-4-6'), steps);
  assert.ok(steps.includes(`databricks grants update model_service system.ai.claude-sonnet-4-6 --json '{"changes":[{"principal":"${PRINCIPAL}","add":["EXECUTE"]}]}'`), steps);
  assert.ok(steps.includes('GRANT USE CATALOG ON CATALOG system TO `' + PRINCIPAL + '`;'), steps);
  assert.ok(steps.includes('GRANT USE SCHEMA ON SCHEMA system.ai TO `' + PRINCIPAL + '`;'), steps);
  assert.ok(!/pay-per-token[^.]*turn on|turn on pay-per-token/i.test(permission.why + steps), 'pay-per-token is never the fix here');
  assert.ok(permission.why.includes('disabled') && permission.why.includes('Unity Gateway'), permission.why);
});

test('a 403 that is not the enforcement refusal does not call the model service, so the pre-enforcement permission path is unchanged', async () => {
  // Must-keep: an ordinary refusal on a workspace without Unity Gateway keeps the CAN_QUERY path and never calls the gateway route.
  const { call, chatCalls } = fake({
    endpoints: [chat(SONNET, 'id-46')],
    probes: { [invocations(SONNET)]: { status: 403, data: { message: 'permission denied' } } },
  });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission, 'still a permission problem');
  assert.equal(chatCalls().length, 0, 'the model service is not tried without the enforcement refusal');
  assert.ok(permission.steps.some((s) => s.includes('serving-endpoints/id-46')), permission.steps.join('\n'));
});

test('a workspace without enforcement that answers the databricks- name needs no model service call', async () => {
  // Must-keep: a usable databricks- endpoint is used as it is.
  const { call, chatCalls } = fake({ endpoints: [chat(SONNET, undefined)] });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null);
  assert.equal(chatCalls().length, 0);
});

test('invokeChatModel answers through the model service under enforcement and returns the direct answer otherwise', async () => {
  // Fail-pre: invokeChatModel did not exist.
  const body = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 4, temperature: 0 };
  const enforced = fake({ probes: { [invocations(SONNET)]: { status: 403, data: ENFORCED } } });
  const via = await invokeChatModel(enforced.call, SONNET, body);
  assert.equal(via.ok, true);
  assert.equal(enforced.chatCalls()[0].body.model, 'system.ai.claude-sonnet-4-6');

  const direct = fake({});
  const ok = await invokeChatModel(direct.call, 'databricks-gpt-oss-120b', body);
  assert.equal(ok.ok, true);
  assert.equal(direct.chatCalls().length, 0, 'a working direct call makes no second call');

  const plain = fake({ probes: { [invocations('my-team-endpoint')]: { status: 403, data: { message: 'nope' } } } });
  const refused = await invokeChatModel(plain.call, 'my-team-endpoint', body);
  assert.equal(refused.status, 403);
  assert.equal(plain.chatCalls().length, 0, 'an endpoint with no model service is not retried');
});
