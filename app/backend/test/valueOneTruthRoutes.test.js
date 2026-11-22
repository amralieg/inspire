// FX-34 (REQ-448, REQ-454; W16 D2/D3/D5/D9): one run value. Every value route returns the run value valueTotals computes, so the
// Start banner, the run cards, the Review header and the Business panel cannot disagree; the case plan is planned for one use case.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startInspire } = require('./support/serverProcess');
const { makeApp, listen } = require('./support/implementApp');

const ANSWER_COLUMNS = ['use_case_id', 'version', 'answers', 'yearly', 'saved_at', 'saved_by', 'note'];
const QUERY = 'inspire_database=c.s&warehouse_id=w1';
const savedRow = (id, amount, calculated) => [id, '1',
  JSON.stringify({ shape: 2, currency: 'USD', calculated, plan: { basis: 'use_case', use_case_id: id, table: `c.s.t_${id}`, drivers: [] } }),
  JSON.stringify({ verb: 'REDUCE COST', calculated, estimated: !calculated, currency: 'USD', total: { unit: 'USD', amount }, parts: [{ id: 'p', verb: 'REDUCE COST', amount }] }),
  '2026-11-21 10:00:00', 'p@example.com', ''];
const RUNS = { 42: [savedRow('A', 6800000, true), savedRow('B', 2400000, false)], 43: [savedRow('D', 1200000, false)] };  // run 43 has its own pool; the same pool in two runs counts once (REQ-454)
const USE_CASES = { 42: ['A', 'B', 'C'], 43: ['D'] };

function fakeWarehouse() {
  const sidsOf = (sql, bound) => {
    if (sql.includes('__inspire_value_answers')) return Object.values(bound).map(String);
    const m = /session_id IN \(([^)]*)\)/.exec(sql);
    return m ? m[1].split(',').map((x) => x.replace(/['\s]/g, '')) : null;
  };
  const answer = (sql, parameters) => {
    const bound = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    if (sql.includes('ORDER BY create_at DESC')) return { columns: ['session_id', 'business_name', 'create_at'], rows: [['43', 'Second', '2026-11-21 10:00:00'], ['42', 'First', '2026-11-20 10:00:00']] };
    const listed = sql.includes('session_id IN (') ? sidsOf(sql, bound) : null;
    const sids = listed || (sql.includes('__inspire_value_answers') ? [String(Object.values(bound)[0])] : (/session_id = (\d+)/.exec(sql) || [])[1] ? [/session_id = (\d+)/.exec(sql)[1]] : []);
    const lead = (sid, row) => (listed ? [sid, ...row] : row);
    const cols = (list) => (listed ? ['session_id', ...list] : list);
    if (sql.includes('__inspire_value_answers')) return { columns: cols(ANSWER_COLUMNS), rows: sids.flatMap((sid) => (RUNS[sid] || []).map((r) => lead(sid, r))) };
    if (sql.includes('primary_table FROM')) return { columns: cols(['id', 'primary_table']), rows: sids.flatMap((sid) => (USE_CASES[sid] || []).map((id) => lead(sid, [id, `c.s.t_${id}`]))) };
    if (sql.includes('business_domain')) return { columns: cols(['id', 'business_domain', 'value_estimate']), rows: sids.flatMap((sid) => (USE_CASES[sid] || []).map((id) => lead(sid, [id, 'D', null]))) };
    return { columns: ['x'], rows: [] };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const sent = body ? JSON.parse(body) : {};
      const { columns, rows } = answer(String(sent.statement || ''), (sent.parameters || []).map((p) => ({ name: p.name, value: p.value })));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ statement_id: 's', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) }, total_chunk_count: 1 }, result: { data_array: rows } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

let warehouse;
let inspire;
test.before(async () => {
  warehouse = await fakeWarehouse();
  inspire = await startInspire({ DATABRICKS_HOST: warehouse.url, DATABRICKS_TOKEN: 'test-token', NODE_ENV: 'test' });
});
test.after(async () => {
  if (inspire) await inspire.stop();
  if (warehouse) await new Promise((resolve) => warehouse.server.close(resolve));
});
const get = async (route) => {
  const resp = await fetch(`${inspire.url}${route}`);
  const body = await resp.json();
  assert.equal(resp.status, 200, `${route}: ${JSON.stringify(body)}`);
  return body;
};

test('1c: /value/totals, /value/estimates, /value/runs and /value/overall return the same run value for every run and for all runs', async () => {
  const one = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.ok(one.run_value, 'the single-run totals carry run_value');
  assert.deepEqual(one.run_value.totals, [{ currency: 'USD', amount: 9200000, calculated: 6800000, estimated: 2400000 }]);
  assert.deepEqual([one.run_value.n, one.run_value.n_calculated, one.run_value.n_estimated, one.run_value.n_none], [3, 1, 1, 1]);
  const estimates = await get(`/api/inspire/value/estimates?${QUERY}&session_id=42`);
  assert.deepEqual(estimates.run_value, one.run_value, '/value/estimates (one run) = /value/totals');
  const all = await get(`/api/inspire/value/totals?${QUERY}`);
  const row42 = all.runs.find((r) => r.session_id === '42');
  assert.deepEqual(row42.run_value, one.run_value, 'the all-runs row of run 42 = the run read');
  const runs = await get(`/api/inspire/value/runs?${QUERY}`);
  assert.deepEqual(runs.run_values['42'], one.run_value, '/value/runs (the run cards) = /value/totals');
  assert.deepEqual(runs.run_values['43'], all.runs.find((r) => r.session_id === '43').run_value);
  const overall = await get(`/api/inspire/value/overall?${QUERY}`);
  assert.deepEqual(overall.run_value, all.all, '/value/overall (the Start banner) = the all-runs total');
  const allEstimates = await get(`/api/inspire/value/estimates?${QUERY}`);
  assert.deepEqual(allEstimates.run_value, all.all, '/value/estimates (all runs) = the all-runs total');
  assert.deepEqual(allEstimates.run_values['42'], one.run_value);
  assert.equal(all.all.totals[0].amount, 10400000, 'both runs add up');
});

// 1a through the route: the model is asked about this use case, and the plan says whose it is.
const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const MODEL_PLAN = { case_noun: 'late delivery', groupings: [{ column: 'region', label: 'By region' }], metrics: [],
  drivers: [{ id: 'risk_avoided', on: true, why: 'x', asks: [{ id: 'incidents_per_year', source: 'data', metric: 'records' }] }] };
const ENDPOINTS = [{ endpoints: [{ name: 'chat-1', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }];
const USE_CASE_ROWS = [{ id: 'N01-U01', use_case: 'Spot late deliveries', statement: 'Late deliveries cause stock-outs.' },
  { id: 'N01-U02', use_case: 'Price by demand', statement: 'Prices ignore demand.' }];

test('1a: case-plan asks the model about the use case it plans, and the plan carries its use case and basis', async () => {
  const made = makeApp({ forwardedToken: 'person-tok', columns: COLUMNS, useCases: USE_CASE_ROWS,
    responses: { 'GET /api/2.0/serving-endpoints': ENDPOINTS, 'POST /serving-endpoints/chat-1/invocations': [{ choices: [{ message: { content: JSON.stringify(MODEL_PLAN) } }] }] },
    statements: { 'AS records': (sql) => (sql.includes(' AS g') ? { rows: [{ g: 'north', records: '4000' }] } : { rows: [{ records: '4000', days: '365' }] }) } });
  const srv = await listen(made.app);
  const plans = [];
  try {
    for (const id of ['N01-U01', 'N01-U02']) {
      const resp = await fetch(`${srv.url}/api/inspire/value/case-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' },
        body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: id, table: 'main.s.orders' }) });
      const data = await resp.json();
      assert.equal(resp.status, 200, JSON.stringify(data));
      plans.push(data.plan);
    }
  } finally {
    await srv.close();
  }
  assert.deepEqual(plans.map((p) => [p.use_case_id, p.basis]), [['N01-U01', 'use_case'], ['N01-U02', 'use_case']]);
  const asked = made.fetches.filter((f) => f.path.includes('/invocations')).map((f) => String(f.opts && f.opts.body));
  assert.equal(asked.length, 2);
  assert.match(asked[0], /Spot late deliveries/);
  assert.match(asked[1], /Price by demand/);
});
