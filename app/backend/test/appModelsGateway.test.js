// REQ-475 (REQ-471): the App's own model calls (value plan, anchor, review; vibe draft; describe value) work on a workspace that serves
// models only through the Unity Gateway: the one picker lists the ready serving endpoints first, then the gateway's system.ai models.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const OWNER = ['owner', 'example.com'].join('@');
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const GROUPED = { rows: [{ g: 'north', records: '1000', days: '365' }, { g: 'south', records: '3000', days: '365' }] };
const POPULATION = { rows: [{ records: '4000', days: '365' }] };
const SONNET = 'system.ai.claude-sonnet-5-5';
const HAIKU = 'system.ai.claude-haiku-4-5';
const GLM = 'anthropic-aigw-73ea02b2-system.ai.glm-5-2';
const NONE = [{ endpoints: [] }];
const READY = [{ endpoints: [{ name: 'chat-1', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }];
const chat = (obj) => [{ choices: [{ message: { content: JSON.stringify(obj) } }] }];
const PLAN = { case_noun: 'order', case_filter: null, groupings: [{ column: 'region', label: 'By region' }], metrics: [],
  drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
    { id: 'base_revenue_per_year', source: 'estimate', default: 600000, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 100, why: 'a guess' }] }] };
const ANCHOR = { low: 200000, high: 2000000, typical: 600000, business_revenue_estimate: 5e9, reason: 'mid size', economic_trend: null };
const REVIEW = { approved: true, amount: 600000, reason: 'ok' };
const kindOf = (body) => (/^You anchor/.test(body.messages[0].content) ? 'anchor' : /^You review/.test(body.messages[0].content) ? 'review' : 'plan');
const VALUE = { explanation: 'a flat amount', value: { method: 'fixed', amount: 100, currency: 'USD' } };

// A gateway world: `gateway.claude` / `gateway.codex` are the listed ids; every gateway chat call is recorded as { path, model }.
function world({ endpoints = NONE, claude = [], codex = [], answer, extra = {} } = {}) {
  const chats = [];
  const gateway = { claude, codex, answer: (path, model) => {
    chats.push({ path, model });
    return answer ? answer(path, model) : [{ choices: [{ message: { content: 'x' } }] }];
  } };
  return { chats, gateway, endpoints, extra };
}
const planAnswer = (path, model, body) => chat(PLAN);

async function withValueApp(w, route, extraBody, run) {
  const asked = [];
  const workspace = ({ path, method, body }) => {
    if (method === 'POST' && (path.includes('/invocations') || path.startsWith('/ai-gateway/'))) {
      asked.push({ path, model: body && body.model });
      const kind = kindOf(body);
      return kind === 'anchor' ? chat(ANCHOR) : kind === 'review' ? chat(REVIEW) : chat(PLAN);
    }
    return undefined;
  };
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, workspace, gateway: w.gateway,
    responses: { 'GET /api/2.0/serving-endpoints': w.endpoints },
    statements: { 'AS records': (sql) => (sql.includes(' AS g') ? GROUPED : POPULATION) } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' },
      body: JSON.stringify({ ...BODY, ...extraBody }) });
    return await run({ status: resp.status, data: await resp.json() }, made, asked);
  } finally {
    await srv.close();
  }
}
const gatewayReads = (made) => made.fetches.filter((f) => f.path.startsWith('/ai-gateway/') && !f.path.includes('chat/completions')).map((f) => f.path);

test('G1: no serving endpoints, gateway lists claude: case-plan plans with the newest sonnet through the gateway chat route', async () => {
  const w = world({ claude: [HAIKU, SONNET, 'system.ai.claude-opus-5-5'] });
  await withValueApp(w, '/api/inspire/value/case-plan', {}, async (got, made, asked) => {
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.plan.model, SONNET, JSON.stringify(got.data.plan.model_reason));
    assert.equal(got.data.plan.model_reason, undefined);
    assert.ok(asked.length >= 2, 'the anchor, plan and review calls were made');
    assert.ok(asked.every((a) => a.path === '/ai-gateway/mlflow/v1/chat/completions' && a.model === SONNET), JSON.stringify(asked));
    assert.ok(!made.fetches.some((f) => f.path.includes('/invocations')), 'no serving-endpoints call for a gateway model');
  });
});

test('G2: no serving endpoints, gateway lists claude: describe-value answers 200 with the sonnet model', async () => {
  const w = world({ claude: [HAIKU, SONNET] });
  const workspace = ({ path, method }) => (method === 'POST' && path.startsWith('/ai-gateway/') ? chat(VALUE) : undefined);
  const made = makeApp({ forwardedToken: 'person-tok', workspace, gateway: w.gateway, responses: { 'GET /api/2.0/serving-endpoints': w.endpoints } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/money/describe-value`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' },
      body: JSON.stringify({ text: 'each record is worth 100 dollars', columns: ['region'] }) });
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.equal(data.model, SONNET);
  } finally {
    await srv.close();
  }
});

// The feedback vibe route: the setup of appFeedback.test.js, with a workspace that serves no endpoint.
const BASE = {
  use_case_id: 'N01-U01', use_case_name: 'Predict churn', vibes: 'Show churn by region',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_owners: [] },
};
const builtRow = () => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(BASE, 'https://inspire.example.com')).spec), app_name: 'churn-desk',
  app_url: 'https://churn-desk-1.aws.databricksapps.com',
  asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 1 }, dashboard: { state: 'ready', spec_version: 1 } }),
});
const ISSUE = { feedback_id: 'a1b2', section: 'work', record_key: 'R001', text: 'The due date shows last year', filters: 'Region: North',
  reported_by: 'someone.else@example.com', reported_at: '2026-11-08 10:00:00', status: 'new', vibe_text: null, handled_by: null, handled_at: null };
const TABLE = '`main`.`inspire`.`churn_out_feedback`';

test('G3: no serving endpoints, gateway lists claude: the feedback vibe route reaches the gateway model', async () => {
  const w = world({ claude: [HAIKU, SONNET], answer: () => chat({ vibe: 'On Work, show the due date of each record', genie_should: 'Fix it' }) });
  const statements = {
    [`FROM ${TABLE} WHERE use_case_id = :uc AND feedback_id = :id`]: () => ({ rows: [ISSUE] }),
    [`FROM ${TABLE} WHERE use_case_id = :uc ORDER BY`]: () => ({ rows: [ISSUE] }),
  };
  const made = makeApp({ history: [builtRow()], forwardedToken: 'person-token', statements, gateway: w.gateway,
    appApi: { 'GET /api/app': [{ pages: [] }] }, responses: { 'GET /api/2.0/serving-endpoints': w.endpoints } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/feedback/vibe?inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', feedback_id: 'a1b2' }) });
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.equal(data.model, SONNET);
    assert.deepEqual(w.chats, [{ path: '/ai-gateway/mlflow/v1/chat/completions', model: SONNET }]);
  } finally {
    await srv.close();
  }
});

test('G4: a ready chat serving endpoint is used as today and no gateway list is read', async () => {
  const w = world({ endpoints: READY, claude: [SONNET] });
  await withValueApp(w, '/api/inspire/value/case-plan', {}, async (got, made, asked) => {
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.plan.model, 'chat-1');
    assert.ok(asked.length >= 1 && asked.every((a) => a.path === '/serving-endpoints/chat-1/invocations'), JSON.stringify(asked));
    assert.deepEqual(gatewayReads(made), []);
  });
});

test('G5: both lists empty: the plan falls back and says no model is ready as an endpoint or through the AI Gateway', async () => {
  await withValueApp(world({}), '/api/inspire/value/case-plan', {}, async (got) => {
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.plan.model, null);
    assert.match(got.data.plan.model_reason, /through the AI Gateway/);
  });
});

test('G6: an anthropic-aigw- id is never picked, and the other gateway ids come in the order sonnet, haiku, opus, others', async () => {
  const w = world({ claude: [GLM, 'system.ai.claude-opus-5-5', 'system.ai.claude-sonnet-4-6', HAIKU, SONNET], codex: ['system.ai.kimi-k3'] });
  await withValueApp(w, '/api/inspire/value/case-plan', {}, async (got, _made, asked) => {
    assert.equal(got.data.plan.model, SONNET);
    assert.ok(asked.every((a) => a.model !== GLM));
  });
  const only = world({ claude: [GLM] });
  await withValueApp(only, '/api/inspire/value/case-plan', {}, async (got, _made, asked) => {
    assert.equal(got.data.plan.model, null);
    assert.equal(asked.length, 0, 'the glm id is not called');
  });
  const second = world({ claude: [HAIKU, 'system.ai.claude-opus-5-5'], codex: ['system.ai.kimi-k3'] });
  await withValueApp(second, '/api/inspire/value/case-plan', {}, async (got) => {
    assert.equal(got.data.plan.model, HAIKU, 'haiku before opus before the others');
  });
});
