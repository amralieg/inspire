// REQ-448 (D3): the fallback plan counts nothing on its own; a model that is not reachable gives a plan with no invented money.
const test = require('node:test');
const assert = require('node:assert/strict');
const VCP = require('../lib/valueCasePlan');
const { makeApp, listen } = require('./support/implementApp');

const COLUMNS = [
  { column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 },
];

test('every driver of the fallback plan is off', () => {
  assert.ok(VCP.fallbackPlan(COLUMNS).drivers.every((d) => d.on === false));
});

test('the live bug: the fallback plan over 1,825,000 records a year is worth 0, not $638.96M', () => {
  const plan = { ...VCP.fallbackPlan(COLUMNS), groups: [{ g: 'Other', records_per_year: 1825000, metrics: {} }] };
  const got = VCP.yearlyOf(plan, { currency: 'USD', attribution_pct: 100, drivers: {} });
  assert.equal(got.yearly.total.amount, 0);
});

const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
async function planWith(responses) {
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, responses,
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

test('case-plan route: a denied model and no endpoint both give model null and a plain model_reason', async () => {
  const denied = await planWith({ 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-1', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }], 'POST /serving-endpoints/chat-1/invocations': [{ message: 'denied' }, 403] });
  const none = await planWith({ 'GET /api/2.0/serving-endpoints': [{}] });
  for (const got of [denied, none]) {
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.plan.model, null);
    assert.equal(typeof got.data.plan.model_reason, 'string');
    assert.ok(got.data.plan.model_reason.length > 0);
    assert.ok(got.data.plan.drivers.every((d) => d.on === false));
  }
});
