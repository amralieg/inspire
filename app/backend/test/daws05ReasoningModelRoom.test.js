// D-aws-05: on a gateway reasoning model the value review answered "The model system.ai.claude-sonnet-5-5 gave no usable review. Saved as an estimate."
// Cause (same class as FX-101): the model's reasoning counts against max_tokens, and the review asked for 400, so the reply was cut off before its JSON.
// Every App model call that must answer with JSON gets room for the reasoning: here the model is cut off (finish_reason length) below 2000 tokens.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ROOM = 2000;
const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const PLAN = { case_noun: 'order', case_filter: null, groupings: [], metrics: [], drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
  { id: 'base_revenue_per_year', source: 'estimate', default: 10000000, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 5, why: 'a guess' }] }] };
const ANCHOR = { low: 100000, high: 5000000, typical: 500000, business_revenue_estimate: 200000000, reason: 'a typical uplift' };
const REVIEW = { approved: true, amount: 500000, reason: 'plausible for this business' };
const DESCRIBED = { explanation: 'A fixed amount per record.', value: { method: 'fixed', amount: 120, currency: 'USD' } };
const ENDPOINTS = { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] };

// A reasoning model: below ROOM tokens its thinking uses the budget and the JSON is cut off; with room it finishes.
const reasoningModel = (asked) => ({ path: p, body }) => {
  if (!p.endsWith('/chat-new/invocations')) return undefined;
  const first = String(body.messages[0].content);
  const kind = /^You anchor/.test(first) ? 'anchor' : /^You review/.test(first) ? 'review' : /value rule|directive/i.test(first) ? 'describe' : 'plan';
  asked.push([kind, body.max_tokens]);
  const full = JSON.stringify(kind === 'anchor' ? ANCHOR : kind === 'review' ? REVIEW : kind === 'describe' ? DESCRIBED : PLAN);
  if (!(body.max_tokens >= ROOM)) return [{ choices: [{ finish_reason: 'length', message: { content: full.slice(0, 20) } }] }, 200];
  return [{ choices: [{ finish_reason: 'stop', message: { content: full } }] }, 200];
};

async function post(workspace, path, body) {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, workspace, responses: ENDPOINTS,
    statements: { 'AS records': { rows: [{ g: 'north', records: '1000', days: '365', records_total: '1000' }] } } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' }, body: JSON.stringify(body) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

const casePlan = (workspace) => post(workspace, '/api/inspire/value/case-plan',
  { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: 'main.s.t' });

test('the value review of a reasoning model has room for its answer, so the plan is reviewed by the model', async () => {
  const asked = [];
  const got = await casePlan(reasoningModel(asked));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const review = got.data.plan.review;
  assert.ok(review, `no review in the plan: ${JSON.stringify(got.data.plan).slice(0, 300)}`);
  assert.doesNotMatch(String(review.reason), /no usable review/, `asked ${JSON.stringify(asked)}`);
  assert.equal(review.model, 'chat-new', `review ${JSON.stringify(review)}; asked ${JSON.stringify(asked)}`);
  assert.equal(review.approved, true);
});

test('the value anchor of a reasoning model has room for its answer, so the review sees the anchor', async () => {
  const asked = [];
  const got = await casePlan(reasoningModel(asked));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const anchor = got.data.plan.review && got.data.plan.review.anchor;
  assert.ok(anchor, `no anchor; asked ${JSON.stringify(asked)}`);
  assert.equal(anchor.typical, ANCHOR.typical);
});

test('describe-value on a reasoning model has room for the JSON rule', async () => {
  const asked = [];
  const got = await post(reasoningModel(asked), '/api/money/describe-value',
    { text: 'each record is worth 120 dollars', columns: ['region', 'event_date'] });
  assert.equal(got.status, 200, `${JSON.stringify(got.data)}; asked ${JSON.stringify(asked)}`);
  assert.deepEqual(got.data.value, DESCRIBED.value);
});

test('a model that never finishes is still reported as no usable review, never as approved', async () => {
  const got = await casePlan(({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    const first = String(body.messages[0].content);
    if (/^You review/.test(first)) return [{ choices: [{ finish_reason: 'length', message: { content: '{"appro' } }] }, 200];
    return reasoningModel([])({ path: p, body });
  });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.match(String(got.data.plan.review.reason), /gave no usable review/);
  assert.equal(got.data.plan.review.approved, false);
});
