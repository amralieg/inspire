// D-uae-03b (REQ-494): Amr asked for more than 3 market and customer factors per use case ("consumer index, CSATs, etc, just make it relevant").
// Live W22 uae: the anchor named only 2. The anchor must ask for at least 4, and when the model still names fewer than 4, the App asks it once more
// for further distinct factors, so the plan carries at least 4 (at most 6).
const test = require('node:test');
const assert = require('node:assert/strict');
const VR = require('../lib/valueReview');
const { makeApp, listen } = require('./support/implementApp');

const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const PLAN = { case_noun: 'order', case_filter: null, groupings: [], metrics: [], drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
  { id: 'base_revenue_per_year', source: 'estimate', default: 1000000, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 1, why: 'a guess' }] }] };
const f = (id) => ({ id, label: id.replace(/_/g, ' '), why: 'moves revenue', likely_pct: 2, min_pct: -5, max_pct: 5 });
const ANCHOR = (factors) => JSON.stringify({ low: 1000, high: 500000, typical: 50000, business_revenue_estimate: 0, reason: 'ok', economic_factors: factors });
const reply = (content) => [{ choices: [{ finish_reason: 'stop', message: { content } }] }, 200];

async function planWith(workspace) {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, workspace,
    responses: { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] },
    statements: { 'AS records': { rows: [{ g: 'north', records: '1000', days: '365', records_total: '1000' }] } } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/case-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: 'main.s.t' }) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

// Every call that is neither the plan nor the review is a factor call: the first names 2 factors, any later one names 3 more (one repeated).
function fakeModel(calls) {
  let factorCalls = 0;
  return ({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    const system = String(body.messages[0].content);
    if (/^You review/.test(system)) return reply(JSON.stringify({ approved: true, amount: 0, reason: 'ok' }));
    if (!/economic_factors/.test(system)) return reply(JSON.stringify(PLAN));
    factorCalls += 1;
    calls.push(body.messages.map((m) => String(m.content)).join('\n'));
    return reply(factorCalls === 1 ? ANCHOR([f('consumer_confidence'), f('customer_satisfaction')]) : ANCHOR([f('customer_satisfaction'), f('market_demand'), f('price_level'), f('seasonal_travel')]));
  };
}

test('A1: the anchor prompt asks for at least 4 relevant factors (no longer "0 to 6")', () => {
  const system = VR.anchorMessages({ useCase: { use_case: 'x' }, businessName: 'b', records: 10, range: { low: 1, high: 100 } })[0].content;
  assert.doesNotMatch(system, /\b0 to 6\b/);
  assert.match(system, /\b4 to 6\b/);
});

test('A2: an anchor with 2 factors gets one top-up ask; the plan carries 4 to 6 distinct factors', async () => {
  const calls = [];
  const got = await planWith(fakeModel(calls));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const ids = (got.data.plan.economic_factors || []).map((x) => x.id);
  assert.ok(ids.length >= 4 && ids.length <= 6, `factors ${JSON.stringify(ids)}`);
  assert.equal(new Set(ids).size, ids.length, 'no factor twice');
  assert.deepEqual(ids.slice(0, 2), ['consumer_confidence', 'customer_satisfaction'], 'the anchor factors are kept first');
  assert.equal(calls.length, 2, `factor calls ${calls.length}`);
  assert.match(calls[1], /consumer_confidence/, 'the top-up names the factors already chosen');
});

test('A3: an anchor that already names 4 factors gets no top-up ask', async () => {
  const calls = [];
  let n = 0;
  const base = fakeModel([]);
  const got = await planWith((req) => {
    const system = req.body && req.body.messages ? String(req.body.messages[0].content) : '';
    if (req.path.endsWith('/chat-new/invocations') && /economic_factors/.test(system) && !/^You review/.test(system)) {
      n += 1;
      calls.push(n);
      return reply(ANCHOR([f('a_one'), f('b_two'), f('c_three'), f('d_four')]));
    }
    return base(req);
  });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal((got.data.plan.economic_factors || []).length, 4);
  assert.equal(calls.length, 1, 'one factor call only');
});
