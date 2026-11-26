// RC7-B-02, B-03, B-14, B-15 (backend): no model id in the review reason, a case plan on a table with no date column still works,
// a reviewer figure outside the yearly range never becomes the plan's value, and the run total is the sum of what each use case adds.
const test = require('node:test');
const assert = require('node:assert/strict');
const VT = require('../lib/valueTotals');
const { makeApp, listen } = require('./support/implementApp');

const DATED = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const UNDATED = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 2 }];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const PLAN = { case_noun: 'order', case_filter: null, groupings: [], metrics: [], drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
  { id: 'base_revenue_per_year', source: 'estimate', default: 10000000, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 5, why: 'a guess' }] }] };
const ANCHOR = { low: 100000, high: 5000000, typical: 500000, business_revenue_estimate: 200000000, reason: 'a typical uplift' };
const ENDPOINTS = { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] };

const model = (review, asked = []) => ({ path: p, body }) => {
  if (!p.endsWith('/chat-new/invocations')) return undefined;
  const first = String(body.messages[0].content);
  const kind = /^You anchor/.test(first) ? 'anchor' : /^You review/.test(first) ? 'review' : 'plan';
  asked.push({ kind, system: first });
  const out = kind === 'anchor' ? ANCHOR : kind === 'review' ? review : PLAN;
  if (out === null) return [{ choices: [{ finish_reason: 'length', message: { content: '{"appro' } }] }, 200];
  return [{ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(out) } }] }, 200];
};

async function casePlan(workspace, columns, extra = {}) {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns, workspace, responses: ENDPOINTS,
    statements: { 'AS records': { rows: [{ g: 'north', records: '1000', days: '365', records_total: '1000' }] } } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/case-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: 'main.s.t', ...extra }) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('B-02: a review that gave no answer says so without naming the model endpoint', async () => {
  const got = await casePlan(model(null), DATED);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.match(String(got.data.plan.review.reason), /no usable review/);
  assert.doesNotMatch(String(got.data.plan.review.reason), /chat-new|system\.ai|claude|databricks-/i);
});

test('B-03: a table with no date column still gets a plan: one year assumed and said so', async () => {
  const got = await casePlan(model({ approved: true, amount: 500000, reason: 'ok' }), UNDATED);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.days, 365);
  assert.equal(got.data.plan.period_assumed, true);
  assert.equal(got.data.plan.groups.reduce((s, g) => s + g.records_per_year, 0), 1000);
});

test('B-03: the period the person gives is used, and then it is not an assumption', async () => {
  const got = await casePlan(model({ approved: true, amount: 500000, reason: 'ok' }), UNDATED, { period_days: 730 });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.days, 730);
  assert.equal(got.data.plan.period_assumed, false);
  assert.equal(got.data.plan.groups.reduce((s, g) => s + g.records_per_year, 0), 500);
});

test('B-15: the reviewer is told the amount is a value per year, and a figure far below the range is never tuned into the plan', async () => {
  const asked = [];
  const got = await casePlan(model({ approved: false, amount: 150.03, reason: 'about 3,000 charges' }, asked), DATED);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const review = asked.find((a) => a.kind === 'review');
  assert.match(review.system, /per year/);
  assert.match(review.system, /never a weekly, monthly or per-record figure/);
  assert.equal(got.data.plan.review.tuned, false);
  assert.ok(!got.data.plan.value_check || got.data.plan.value_check.amount >= 100000, JSON.stringify(got.data.plan.value_check));
});

test('B-14: the run total is the sum of what each use case adds, with a run-review scale and with no overlap key', () => {
  const run = VT.runOf({ ids: ['A', 'B', 'C'], saved: new Map(), noTable: new Set(), tables: {},
    estimates: { A: { status: 'estimated', amount: 466000, currency: 'USD' }, B: { status: 'estimated', amount: 168000, currency: 'USD' }, C: { status: 'estimated', amount: 24000, currency: 'USD' } },
    review: { ai_checked: true, reason: 'x', scales: { B: 0.5 } } });
  const sum = Object.values(run.use_cases).reduce((s, e) => s + (e.counted_amount || 0), 0);
  const total = run.run.totals.reduce((s, t) => s + t.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, total);
  assert.equal(run.use_cases.B.counted_amount, 84000);
  assert.equal(run.use_cases.C.counted, false, 'an estimate outside the range is left out');
});
