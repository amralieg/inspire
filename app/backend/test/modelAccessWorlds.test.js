// REQ-423: the App's pre-launch check (planModelAccess) against every setup in support/modelAccessWorlds.json. Each setup states
// whether the run is blocked and which name it calls; the notebook and the installer consumers check the same file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planModelAccess } = require('../lib/modelAccess');
const WORLDS = require('./support/modelAccessWorlds.json');

const PRINCIPAL = '11111111-2222-3333-4444-555555555555';
const STATUS = { answer: 200, enforced: 403, denied: 403, ratelimit: 429, missing: 404 };

// The REST answer one name gives under a world. The text of each refusal comes from the fixture.
function answerFor(world, name, kind = name) {
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
  test(`setup ${world.setup} (${world.id}): blocked and the callable name match the fixture`, async () => {
    const plan = await planModelAccess({ call: callFor(world), principal: PRINCIPAL });
    assert.equal(plan.blocked, world.expected.blocked, `blocked: ${JSON.stringify(plan)}`);
    assert.equal(plan.callable, world.expected.callable, `callable: ${JSON.stringify(plan)}`);
    assert.equal(plan.permission !== null, world.expected.blocked, 'a blocked run carries a Permission Required entry, an unblocked one none');
  });
}
