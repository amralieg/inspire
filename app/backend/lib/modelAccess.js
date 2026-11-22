// REQ-405: before a run starts, the identity the run uses (the App's service principal, REQ-418) must be
// able to query a chat model. The candidates are the agent's roster order (lib/modelRoster.js), at most the roster's size, each probed
// with one one-word chat call. Any answer passes. A Permission Required entry needs a refusal (HTTP 403) from every probed candidate
// and nothing else: an error that is not a refusal means the check could not tell, so the launch is not blocked.
const { rosterOrder } = require('./modelRoster');
const { permissionRequired } = require('./permissions');

// The agent's roster holds at most six models (TECHNICAL_CONTEXT roster size); probing stops at the first answer.
const CANDIDATE_LIMIT = 6;
const PROBE = { messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 4 };

const grantCommand = (id, principal) => `databricks api patch /api/2.0/permissions/serving-endpoints/${id} --json '{"access_control_list":[{"service_principal_name":"${principal}","permission_level":"CAN_QUERY"}]}'`;

// A workspace endpoint has an id and an ACL. A pay-per-token foundation endpoint (databricks-<model>) has no id; its query access is
// EXECUTE on the Unity Gateway model service system.ai.<model> (account users hold it by default). Mirrors system_model_service in the installer.
const FOUNDATION_PREFIX = 'databricks-';
const systemModelService = (name) => (name.startsWith(FOUNDATION_PREFIX) && name.length > FOUNDATION_PREFIX.length ? `system.ai.${name.slice(FOUNDATION_PREFIX.length)}` : '');
const serviceGrantCommand = (service, principal) => `databricks grants update model_service ${service} --json '{"changes":[{"principal":"${principal}","add":["EXECUTE"]}]}'`;

// REQ-422: a model service is queried by EXECUTE on it plus USE CATALOG on system and USE SCHEMA on system.ai (docs: migrate-to-unity-gateway).
const usageGrants = (principal) => [
  `GRANT USE CATALOG ON CATALOG system TO \`${principal}\`;`, // PERMISSION_DIALOG
  `GRANT USE SCHEMA ON SCHEMA system.ai TO \`${principal}\`;`, // PERMISSION_DIALOG
];

function denialSteps(endpoint, principal) {
  if (endpoint.id) {
    return [`In Databricks, open serving endpoint ${endpoint.name} > Permissions, and add ${principal} with Can query`, grantCommand(endpoint.id, principal)];
  }
  const service = systemModelService(endpoint.name);
  if (!service) return [`In Databricks, ask a workspace admin to give ${principal} Can query on ${endpoint.name}`];
  return [
    `In AI Gateway, open model service ${service} > Permissions, and add ${principal} with Can execute`,
    serviceGrantCommand(service, principal),
    ...usageGrants(principal),
  ];
}

// The Unity Gateway chat route answers a model service by its three-level name (docs: migrate-to-unity-gateway).
const GATEWAY_CHAT = '/ai-gateway/mlflow/v1/chat/completions';
// The refusal Unity Gateway enforcement gives a pay-per-token endpoint. Matched on both phrases, never on PERMISSION_DENIED alone.
const enforcementRefusal = (data) => {
  const text = `${(data && (data.message || data.error)) || ''}`;
  return /is disabled for this workspace/i.test(text) && /unity gateway/i.test(text);
};

// One chat call to a Databricks-hosted model. Under enforcement the databricks- name is refused, so the call is retried on its
// model service through the Unity Gateway chat route. Any other answer is returned as it is.
// Returns the response and whether the direct call was the enforcement refusal (the route that works is then the model service).
async function viaModelService(call, name, body) {
  const direct = await call('POST', `/serving-endpoints/${encodeURIComponent(name)}/invocations`, body);
  const service = systemModelService(name);
  const enforced = direct.status === 403 && Boolean(service) && enforcementRefusal(direct.data);
  if (!enforced) return { response: direct, enforced: false };
  return { response: await call('POST', GATEWAY_CHAT, { ...body, model: service }), enforced: true };
}

async function invokeChatModel(call, name, body) {
  return (await viaModelService(call, name, body)).response;
}

// REQ-424: the admin steps a blocked setup prints, in plain words. The installer prints the steps the App records, the Start page shows
// them as the notes of the Permission Required entry, and test/support/modelAccessWorlds.json holds the one expected text.
const MODEL_STOP_STEPS = {
  none: ['Serve a chat model the App can use: a Databricks-hosted model, a provisioned throughput endpoint, or a Unity Gateway route.',
    'Then grant <principal> CAN_QUERY on that endpoint, or EXECUTE on its system.ai model service with USE CATALOG on system and USE SCHEMA on system.ai.'],
  denied: ['Grant <principal> CAN_QUERY on the chat model endpoints in Serving, or EXECUTE on their system.ai model services with USE CATALOG on system and USE SCHEMA on system.ai.'],
};
const stopSteps = (setup, principal) => (MODEL_STOP_STEPS[setup] || []).map((step) => step.replace('<principal>', principal || '<principal>'));

// The one route the installer reads after deploy for what the App's own model check found (the record is under `field`).
const MODEL_CHECK_ROUTE = { path: '/api/defaults', field: 'modelAccess' };

function permissionFor(principal, denied, enforced, setup) {
  if (denied.length) {
    const names = denied.map((e) => e.name).join(', ');
    const steps = denied.flatMap((e) => denialSteps(e, principal));
    if (enforced.length) {
      const services = enforced.map((e) => systemModelService(e.name)).join(', ');
      return permissionRequired({
        steps,
        instructions: stopSteps(setup, principal),
        principal,
        why: `Unity Gateway is enforced on this workspace, so the pay-per-token endpoint ${names} is disabled and cannot be called. `
          + `Inspire calls the model service ${services} instead, and ${principal} needs EXECUTE on it, plus USE CATALOG on system and USE SCHEMA on system.ai.`,
      });
    }
    return permissionRequired({ steps, instructions: stopSteps(setup, principal), principal, why: `Inspire runs the chat model ${names} as ${principal}, and that identity cannot query it yet.` });
  }
  return permissionRequired({
    steps: [`In Databricks, open Serving, pick a chat model you can use, open its Permissions, and add ${principal} with Can query`],
    instructions: stopSteps(setup, principal),
    principal,
    why: `Inspire runs a chat model as ${principal}, and no chat model is visible to that identity, so it cannot query one yet.`,
  });
}

// The Unity Gateway serves models the agent can also pick (the roster includes its routes). A gateway that lists a model means the
// run is not blocked by the serving endpoints alone.
const GATEWAY_MODELS = '/ai-gateway/codex/v1/models';
// The first model the Unity Gateway lists (Codex route: models[].slug; Anthropic route: data[].id), or '' when it lists none, and the status it answered.
async function gatewaySlug(call) {
  const listed = await call('GET', GATEWAY_MODELS);
  if (!listed.ok) return { slug: '', status: listed.status };
  const rows = [...(listed.data.models || []), ...(listed.data.data || [])];
  const first = rows.find((m) => m && (m.slug || m.id));
  return { slug: first ? String(first.slug || first.id) : '', status: listed.status };
}

// `call(method, path, body)` resolves to { ok, status, data }, the shape jsonOf gives. Returns null when the run may start.
// One candidate: confirmed (with the name the run would call), a refusal (denied, and whether it was the enforcement refusal), or inconclusive.
async function probeCandidate(call, endpoint) {
  const { response, enforced } = await viaModelService(call, endpoint.name, PROBE);
  if (response.ok) return { usable: true, enforced, callable: enforced ? systemModelService(endpoint.name) : endpoint.name };
  if (response.status !== 403) return { inconclusive: true, status: response.status };
  return { denied: true, enforced };
}

// What the run would call and whether the run is blocked. The name is the first confirmed one, in roster order (system.ai first).
// setup is the label the install prints: legacy (the databricks- endpoint answers), enforced (only its system.ai model service answers),
// gateway-only, none, denied, rate limit, or unknown. limited names the models that answered a rate limit.
async function planModelAccess({ call, principal }) {
  const open = (setup, limited = []) => ({ blocked: false, callable: null, permission: null, setup, limited });
  const listed = await call('GET', '/api/2.0/serving-endpoints');
  if (!listed.ok && listed.status !== 403) return open(listed.status === 429 ? 'rate limit' : 'unknown');
  const endpoints = listed.ok ? listed.data.endpoints || [] : [];
  const byName = new Map(endpoints.filter((e) => e && e.name).map((e) => [e.name, e]));
  const candidates = rosterOrder(endpoints).slice(0, CANDIDATE_LIMIT).map((name) => byName.get(name));
  const denied = [];
  const enforced = [];
  const inconclusive = [];
  for (const endpoint of candidates) {
    const result = await probeCandidate(call, endpoint);
    if (result.usable) return { blocked: false, callable: result.callable, permission: null, setup: result.enforced ? 'enforced' : 'legacy', limited: [] };
    if (result.denied) {
      denied.push(endpoint);
      if (result.enforced) enforced.push(endpoint);
    } else inconclusive.push({ name: endpoint.name, status: result.status });
  }
  if (inconclusive.length) {
    const limited = inconclusive.filter((r) => r.status === 429).map((r) => r.name);
    return open(limited.length ? 'rate limit' : 'unknown', limited);
  }
  const gateway = await gatewaySlug(call);
  if (gateway.slug) return { blocked: false, callable: gateway.slug, permission: null, setup: 'gateway-only', limited: [] };
  if (gateway.status === 429) return open('rate limit');
  const setup = listed.status === 403 || gateway.status === 403 || denied.length ? 'denied' : 'none';
  return { blocked: true, callable: null, permission: permissionFor(principal, denied, enforced, setup), setup, limited: [] };
}

// The record the App keeps of its own check and serves on MODEL_CHECK_ROUTE: what the installer reads after deploy.
function selfCheckRecord(plan, principal) {
  return {
    state: 'checked',
    blocked: plan.blocked,
    callable: plan.callable,
    setup: plan.setup,
    steps: plan.blocked ? stopSteps(plan.setup, principal) : [],
    limited: plan.limited || [],
    principal: principal || '',
    checkedAt: new Date().toISOString(),
  };
}

async function modelAccessPermission(args) {
  return (await planModelAccess(args)).permission;
}

module.exports = { modelAccessPermission, planModelAccess, selfCheckRecord, MODEL_CHECK_ROUTE, MODEL_STOP_STEPS, invokeChatModel, systemModelService, CANDIDATE_LIMIT, GATEWAY_CHAT };
