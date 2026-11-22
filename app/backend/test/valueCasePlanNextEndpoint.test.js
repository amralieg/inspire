// FX-46 (REQ-448, 454; W17 D13/D20): the case plan tries the next ready chat endpoint when the first one refuses or errors, so a normal
// install that cannot query its first listed model still plans with another. Every name is still checked; no model at all gives the fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [
  { column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'status', data_type: 'STRING', ordinal_position: 2 },
  { column_name: 'avg_amount', data_type: 'DOUBLE', ordinal_position: 3 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 4 },
];
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const MODEL_PLAN = {
  case_noun: 'fraud case', case_filter: null, groupings: [{ column: 'region', label: 'By region' }],
  metrics: [{ id: 'avg_amount', label: 'Average amount', column: 'avg_amount', agg: 'avg' }],
  drivers: [{ id: 'risk_avoided', label: 'Fraud avoided', on: true, why: 'fewer losses', asks: [
    { id: 'incidents_per_year', source: 'data', metric: 'records' }, { id: 'reduction_pct', source: 'estimate', default: 30, why: 'a guess' }] }],
};
const ready = (name) => ({ name, state: { ready: 'READY' }, task: 'llm/v1/chat' });
const ENDPOINTS = [{ endpoints: [ready('chat-1'), ready('chat-2'), ready('chat-3')] }];
const OK = [{ choices: [{ message: { content: JSON.stringify(MODEL_PLAN) } }] }];
const GROUPED = { rows: [{ g: 'north', records: '1000', days: '365', m_avg_amount: '10' }, { g: 'south', records: '3000', days: '365', m_avg_amount: '20' }] };
const POPULATION = { rows: [{ records: '4000', days: '365' }] };
const appWith = (responses) => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, responses,
  statements: { 'AS records': (sql) => (sql.includes(' AS g') ? GROUPED : POPULATION) } });

async function plan(made) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/case-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' }, body: JSON.stringify(BODY) });
    return { status: resp.status, data: await resp.json() };
  } finally { await srv.close(); }
}

for (const refusal of [[{ message: 'denied' }, 403], [{ message: 'bad request' }, 400], [{ message: 'gone' }, 404]]) {
  test(`case-plan: the first chat endpoint answers ${refusal[1]} and the second ready one plans`, async () => {
    const got = await plan(appWith({ 'GET /api/2.0/serving-endpoints': ENDPOINTS, 'POST /serving-endpoints/chat-1/invocations': refusal, 'POST /serving-endpoints/chat-2/invocations': OK }));
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.plan.model, 'chat-2');
    assert.equal(got.data.plan.case_noun, 'fraud case');
  });
}

test('case-plan: every ready endpoint refuses, so the fallback plan names the grant of the first refusal', async () => {
  const no = [{ message: 'denied' }, 403];
  const got = await plan(appWith({ 'GET /api/2.0/serving-endpoints': ENDPOINTS, 'POST /serving-endpoints/chat-1/invocations': no, 'POST /serving-endpoints/chat-2/invocations': no, 'POST /serving-endpoints/chat-3/invocations': no }));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.model, null);
  assert.match(got.data.plan.model_reason, /Can query on that serving endpoint/);
  assert.match(got.data.plan.model_reason, /chat-1/);
});
