// FX-51 (REQ-448, W18a D50): a calculated value outside 100K-100M, or 0, is never saved as calculated. The model is told the range and asked
// once more when its plan is outside it; a plan still outside carries value_check, so bulk Calculate saves it as an estimate and flags it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const ENDPOINTS = { endpoints: [{ name: 'chat-1', state: { ready: 'READY' }, task: 'llm/v1/chat' }] };
const GROUPED = { rows: [{ g: 'north', records: '1000', days: '365' }, { g: 'south', records: '3000', days: '365' }] };
const POPULATION = { rows: [{ records: '4000', days: '365' }] };

// A plan whose default yearly value is exactly `amount`: one driver, revenue uplift of 100% on `amount` of revenue.
const planWorth = (amount) => ({ case_noun: 'order', case_filter: null, groupings: [{ column: 'region', label: 'By region' }], metrics: [],
  drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
    { id: 'base_revenue_per_year', source: 'estimate', default: amount, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 100, why: 'a guess' }] }] });
const plainReply = (obj) => [{ choices: [{ message: { content: JSON.stringify(obj) } }] }];
const reply = (amount) => [{ choices: [{ message: { content: JSON.stringify(planWorth(amount)) } }] }];
// The model answers each call with the next amount (the last one repeats).
function modelAnswering(...amounts) {
  let n = 0;
  return { next: () => reply(amounts[Math.min(n++, amounts.length - 1)]) };
}
// Anchor and review calls are answered apart from plan calls: no anchor (the generic range stays), and a review that approves.
const workspaceFor = (responses) => ({ path, method, body }) => {
  if (method !== 'POST' || !path.includes('/invocations')) return undefined;
  const first = String(body.messages[0].content);
  if (/^You anchor/.test(first)) return plainReply({});
  if (/^You review/.test(first)) return plainReply({ approved: true, amount: 0, reason: 'ok' });
  return responses.next();
};
async function planWith(...amounts) {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, responses: { 'GET /api/2.0/serving-endpoints': [ENDPOINTS] }, workspace: workspaceFor(modelAnswering(...amounts)),
    statements: { 'AS records': (sql) => (sql.includes(' AS g') ? GROUPED : POPULATION) } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/case-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' }, body: JSON.stringify(BODY) });
    const data = await resp.json();
    const asked = made.fetches.filter((f) => f.path.includes('/invocations')).map((f) => JSON.parse(f.opts.body).messages.map((m) => m.content).join('\n'))
      .filter((text) => !/^You (anchor|review)/.test(text));
    return { status: resp.status, plan: data.plan, asked, data };
  } finally {
    await srv.close();
  }
}

test('FX-51: the plan prompt names the expected yearly range', async () => {
  const got = await planWith(2400000);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.match(got.asked[0], /100000-100000000 per year/);
});

test('FX-51: 23,400 twice: one retry naming the number, then the plan carries value_check and is not clamped', async () => {
  const got = await planWith(23400, 23400);
  assert.equal(got.asked.length, 2, 'asked the model once more');
  assert.match(got.asked[1], /23400/);
  assert.match(got.asked[1], /below 100000/);
  assert.deepEqual(got.plan.value_check, { amount: 23400, low: 100000, high: 100000000 });
  assert.equal(got.plan.drivers.find((d) => d.id === 'revenue_uplift').asks[0].default, 23400);
});

test('FX-51: a value of 0 is never calculated: retried once, then value_check says 0', async () => {
  const got = await planWith(0, 0);
  assert.equal(got.asked.length, 2);
  assert.match(got.asked[1], /zero/);
  assert.equal(got.plan.value_check.amount, 0);
});

test('FX-51: 2.4M is in range: no retry and no value_check', async () => {
  const got = await planWith(2400000);
  assert.equal(got.asked.length, 1);
  assert.equal(got.plan.value_check, undefined);
});

test('FX-51: a retry that lands in range is used and carries no value_check', async () => {
  const got = await planWith(23400, 2400000);
  assert.equal(got.asked.length, 2);
  assert.equal(got.plan.value_check, undefined);
  assert.equal(got.plan.drivers.find((d) => d.id === 'revenue_uplift').asks[0].default, 2400000);
});

test('FX-51: above 100M is retried too', async () => {
  const got = await planWith(250000000, 250000000);
  assert.equal(got.asked.length, 2);
  assert.match(got.asked[1], /above 100000000/);
  assert.equal(got.plan.value_check.amount, 250000000);
});
