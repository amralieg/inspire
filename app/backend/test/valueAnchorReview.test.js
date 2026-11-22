// REQ-472 / REQ-474: the LLM anchor before the plan, the LLM review after it (tuned in up to 3 rounds), the business cap, the economic trend.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const VCP = require('../lib/valueCasePlan');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const ENDPOINTS = [{ endpoints: [{ name: 'chat-1', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }];
const GROUPED = { rows: [{ g: 'north', records: '1000', days: '365' }, { g: 'south', records: '3000', days: '365' }] };
const POPULATION = { rows: [{ records: '4000', days: '365' }] };
const planWorth = (amount) => ({ case_noun: 'order', case_filter: null, groupings: [{ column: 'region', label: 'By region' }], metrics: [],
  drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
    { id: 'base_revenue_per_year', source: 'estimate', default: amount, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 100, why: 'a guess' }] }] });
const ANCHOR = { low: 200000, high: 2000000, typical: 600000, business_revenue_estimate: 5e9, reason: 'mid size', economic_trend: null };
const chat = (obj) => [{ choices: [{ message: { content: JSON.stringify(obj) } }] }];
const kindOf = (body) => (/^You anchor/.test(body.messages[0].content) ? 'anchor' : /^You review/.test(body.messages[0].content) ? 'review' : 'plan');

// anchor: object | [object, status]; plan: amounts (the last repeats); review: functions of the call number or one object / [object, status]
function modelWith({ anchor, plan = [600000], review }) {
  const calls = { anchor: [], plan: [], review: [] };
  const workspace = ({ path, method, body }) => {
    if (method !== 'POST' || !path.includes('/invocations')) return undefined;
    const kind = kindOf(body);
    const n = calls[kind].push(body.messages.map((m) => m.content).join('\n')) - 1;
    if (kind === 'anchor') return anchor === undefined ? [{ message: 'no' }, 500] : Array.isArray(anchor) ? [chat(anchor[0])[0], anchor[1]] : chat(anchor);
    if (kind === 'plan') return chat(planWorth(plan[Math.min(n, plan.length - 1)]));
    const r = typeof review === 'function' ? review(n) : review;
    return Array.isArray(r) ? [r[0], r[1]] : chat(r);
  };
  return { workspace, calls };
}
async function run(model, route = '/api/inspire/value/case-plan', extra = {}, endpoints = ENDPOINTS, statements = {}) {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, workspace: model.workspace, responses: { 'GET /api/2.0/serving-endpoints': endpoints },
    statements: { 'AS records': (sql) => (sql.includes(' AS g') ? GROUPED : POPULATION), ...statements } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' }, body: JSON.stringify({ ...BODY, ...extra }) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}
const yearlyOf = (plan) => VCP.yearlyOf({ ...plan }, { currency: 'USD' }).yearly.total.amount;

test('T1: the plan prompt carries the anchor range and the business name, not the generic range', async () => {
  const model = modelWith({ anchor: ANCHOR, plan: [600000], review: { approved: true, amount: 600000, reason: 'ok' } });
  const got = await run(model);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.match(model.calls.plan[0], /200000/);
  assert.match(model.calls.plan[0], /2000000/);
  assert.doesNotMatch(model.calls.plan[0], /100000-100000000/);
  assert.match(model.calls.anchor[0], /Acme/);
  assert.equal(got.data.plan.likely_value.amount, 600000);
});

test('T2: the 41M case: reviewer says 600000, the plan is tuned to it and approved', async () => {
  const model = modelWith({ anchor: ANCHOR, plan: [41000000, 41000000], review: { approved: false, amount: 600000, reason: 'too high for this business' } });
  const got = await run(model);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const { plan } = got.data;
  assert.equal(plan.review.tuned, true);
  assert.equal(plan.review.approved, true);
  assert.ok(Math.abs(yearlyOf(plan) - 600000) <= 6000, `got ${yearlyOf(plan)}`);
  assert.equal(plan.value_check, undefined);
  assert.ok(model.calls.anchor.length === 1 && model.calls.plan.length <= 2 && model.calls.review.length <= 3);
});

test('T3: the business cap: 1% of the estimated revenue lowers the anchor high', async () => {
  const model = modelWith({ anchor: { ...ANCHOR, low: 1000000, high: 50000000, typical: 5000000, business_revenue_estimate: 1e9 }, plan: [5000000], review: { approved: true, amount: 5000000, reason: 'ok' } });
  const got = await run(model);
  assert.equal(got.data.plan.review.anchor.high, 10000000);
  assert.match(model.calls.plan[0], /10000000/);
});

test('T4: a reviewer that answers 403: review not approved, value_check set, the plan is still 200', async () => {
  const model = modelWith({ anchor: ANCHOR, plan: [600000], review: [{ message: 'denied' }, 403] });
  const got = await run(model);
  assert.equal(got.status, 200);
  assert.equal(got.data.plan.review.approved, false);
  assert.ok(got.data.plan.value_check);
});

test('T5: no model at all: the fallback plan, no anchor and no review calls', async () => {
  const model = modelWith({ anchor: ANCHOR });
  const got = await run(model, undefined, {}, [{ endpoints: [] }]);
  assert.equal(got.status, 200);
  assert.equal(got.data.plan.model, null);
  assert.equal(got.data.plan.review, undefined);
  assert.deepEqual([model.calls.anchor.length, model.calls.plan.length, model.calls.review.length], [0, 0, 0]);
});

test('T6: value/estimate carries review.approved and review.reason; the yearly is unchanged', async () => {
  const body = { table: ORDERS, answers: { money: { currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } }, kpi: { name: 'revenue', direction: 'increase' } } };
  const cols = [{ column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
  const sample = { 'AS sampled': { rows: [{ currency: 'USD', stake: '1000', sampled: '100', eligible: '10000', days: '90' }] } };
  const make = (workspace) => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: cols, workspace, responses: { 'GET /api/2.0/serving-endpoints': ENDPOINTS }, statements: sample });
  const post = async (made) => {
    const srv = await listen(made.app);
    try {
      const resp = await fetch(`${srv.url}/api/inspire/value/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' }, body: JSON.stringify({ ...BODY, ...body }) });
      return resp.json();
    } finally { await srv.close(); }
  };
  const model = modelWith({ anchor: ANCHOR, review: { approved: true, amount: 405556, reason: 'plausible' } });
  const withModel = await post(make(model.workspace));
  const without = await post(make(undefined));
  assert.equal(withModel.review.approved, true);
  assert.equal(withModel.review.reason, 'plausible');
  assert.equal(withModel.yearly.entries[0].amount, without.yearly.entries[0].amount);
});

test('T7: economic trend on lowers the yearly by its pct; off is unchanged; an unknown option is refused', () => {
  const trend = { likely: 'bear', options: [{ id: 'bear', label: 'Bear market', pct: -20, why: 'x' }, { id: 'bull', label: 'Bull market', pct: 10, why: 'y' }] };
  const plan = { ...planWorth(1000000), groups: [], economic_trend: trend, drivers: planWorth(1000000).drivers.map((d) => ({ ...d, verb: 'x', asks: d.asks.map((a) => ({ ...a, kind: a.id === 'uplift_pct' ? 'pct' : 'money', label: a.id })) })) };
  const base = VCP.yearlyOf(plan, { currency: 'USD' }).yearly.total.amount;
  const on = VCP.yearlyOf(plan, { currency: 'USD', economic_trend: { on: true, option: 'bear' } }).yearly;
  assert.equal(on.total.amount, base * 0.8);
  assert.ok(on.parts.some((p) => p.label === 'Bear market' && p.pct === -20));
  assert.equal(VCP.yearlyOf(plan, { currency: 'USD', economic_trend: { on: false, option: 'bear' } }).yearly.total.amount, base);
  assert.ok(VCP.yearlyOf(plan, { currency: 'USD', economic_trend: { on: true, option: 'nope' } }).errors.economic_trend);
});

test('T8: the reviewer rejects twice then approves: 3 review calls, approved', async () => {
  const model = modelWith({ anchor: ANCHOR, plan: [41000000], review: (n) => (n < 2 ? { approved: false, amount: n === 0 ? 900000 : 700000, reason: 'adjust' } : { approved: true, amount: 700000, reason: 'good' }) });
  const got = await run(model);
  assert.equal(model.calls.review.length, 3);
  assert.equal(got.data.plan.review.approved, true);
  assert.equal(got.data.plan.review.tuned, true);
  assert.ok(Math.abs(yearlyOf(got.data.plan) - 700000) <= 7000);
});

test('T8b: never approved in 3 rounds: tuned to the last amount, not approved, value_check set', async () => {
  const model = modelWith({ anchor: ANCHOR, plan: [41000000], review: (n) => ({ approved: false, amount: 900000 - n * 100000, reason: 'no' }) });
  const got = await run(model);
  assert.equal(model.calls.review.length, 3);
  assert.equal(got.data.plan.review.approved, false);
  assert.ok(got.data.plan.value_check);
  assert.ok(Math.abs(yearlyOf(got.data.plan) - 700000) <= 7000);
});

test('T9: an anchor that marks the use case not macro-sensitive: plan.economic_trend is null; a model trend is carried', async () => {
  const none = await run(modelWith({ anchor: ANCHOR, plan: [600000], review: { approved: true, amount: 600000, reason: 'ok' } }));
  assert.equal(none.data.plan.economic_trend, null);
  const trend = { likely: 'bear', options: [{ id: 'bear', label: 'Bear market', pct: -90, why: 'x' }, { id: 'bull', label: 'Bull market', pct: 10, why: 'y' }] };
  const some = await run(modelWith({ anchor: { ...ANCHOR, economic_trend: trend }, plan: [600000], review: { approved: true, amount: 600000, reason: 'ok' } }));
  assert.equal(some.data.plan.economic_trend.options[0].pct, -50);
});
