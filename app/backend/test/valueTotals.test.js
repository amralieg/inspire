// REQ-439 (C6): the run and all-runs value totals include the saved Calculate values. Latest version per use case, per currency, never converted.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startInspire } = require('./support/serverProcess');

const ANSWER_COLUMNS = ['use_case_id', 'version', 'answers', 'yearly', 'saved_at', 'saved_by', 'note'];
const QUERY = 'inspire_database=c.s&warehouse_id=w1';
const CAP = 20;

const saved = (id, version, amount, { shape = 2, calculated = false, currency = 'USD', verb = 'REDUCE COST' } = {}) => [
  id, String(version), JSON.stringify(shape ? { shape, currency, calculated } : { currency }),
  JSON.stringify({ verb, calculated, estimated: !calculated, currency, total: { unit: currency, amount }, parts: [{ id: 'p', verb, amount }] }), '2026-11-21 10:00:00', 'p@example.com', '',
];
const RULE = { use_case_name: 'App', money: { currency: 'convert', base: 'USD', value: { method: 'fixed', amount: 50, currency: 'USD' } }, config: { result_table: 'c.s.orders' } };

// answersBySession: { '42': [rows of every version] }. Like the real table, the latest version per use case is read.
function fakeWarehouse(state) {
  const answer = (sql, parameters) => {
    const bound = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    if (sql.includes('__inspire_value_answers')) {
      const sid = Object.values(bound)[0];
      const latest = new Map();
      for (const row of (state.answersBySession[sid] || [])) {
        if (!latest.has(row[0]) || Number(row[1]) > Number(latest.get(row[0])[1])) latest.set(row[0], row);
      }
      return { columns: ANSWER_COLUMNS, rows: [...latest.values()] };
    }
    if (sql.includes('ORDER BY create_at DESC')) return { columns: ['session_id', 'business_name', 'create_at'], rows: state.sessions };
    if (sql.includes('primary_table FROM')) return { columns: ['id', 'primary_table'], rows: state.useCases.map((id) => [id, state.noTable.includes(id) ? '' : 'c.s.orders']) };
    if (sql.includes('SELECT id, business_domain')) return { columns: ['id', 'business_domain', 'value_estimate'], rows: state.useCases.map((id) => [id, 'D', null]) };
    if (sql.includes('PARTITION BY use_case_id ORDER BY spec_version')) return { columns: ['use_case_id', 'spec'], rows: state.useCases.includes('C') ? [['C', JSON.stringify(RULE)]] : [] };
    if (sql.includes('_summary` WHERE use_case_id')) return { columns: ['kpi_baseline'], rows: [['22000']] };
    return { columns: ['x'], rows: [] };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const sent = body ? JSON.parse(body) : {};
      const parameters = (sent.parameters || []).map((p) => ({ name: p.name, value: p.value }));
      const { columns, rows } = answer(String(sent.statement || ''), parameters);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ statement_id: 's', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) }, total_chunk_count: 1 }, result: { data_array: rows } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const state = { answersBySession: {}, sessions: [], useCases: [], noTable: [] };
let warehouse;
let inspire;
test.before(async () => {
  warehouse = await fakeWarehouse(state);
  inspire = await startInspire({ DATABRICKS_HOST: warehouse.url, DATABRICKS_TOKEN: 'test-token', NODE_ENV: 'test' });
});
test.after(async () => {
  if (inspire) await inspire.stop();
  if (warehouse) await new Promise((resolve) => warehouse.server.close(resolve));
});
const get = async (route) => {
  const resp = await fetch(`${inspire.url}${route}`);
  return { status: resp.status, body: await resp.json() };
};
const set = (patch) => Object.assign(state, { answersBySession: {}, sessions: [], useCases: [], noTable: [] }, patch);
const usd = (totals) => totals.find((t) => t.currency === 'USD');

test('a run of 4 use cases: calculated, saved-not-calculated, rule estimate, nothing', async () => {
  set({ useCases: ['A', 'B', 'C', 'D'], answersBySession: { 42: [saved('A', 1, 3200000, { calculated: true }), saved('B', 1, 2400000)] } });
  const { status, body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.run.totals, [{ currency: 'USD', amount: 6700000, calculated: 3200000, estimated: 3500000 }]);
  assert.deepEqual([body.run.n, body.run.n_calculated, body.run.n_estimated, body.run.n_none], [4, 1, 2, 1]);
  assert.deepEqual(['A', 'B', 'C', 'D'].map((id) => body.use_cases[id].status), ['calculated', 'estimated', 'estimated', 'none']);
  assert.equal(body.use_cases.A.amount, 3200000);
  assert.equal(body.use_cases.A.currency, 'USD');
});

test('a use case with no table is no_data', async () => {
  set({ useCases: ['A', 'D'], noTable: ['D'], answersBySession: { 42: [saved('A', 1, 10, { calculated: true })] } });
  const { body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.equal(body.use_cases.D.status, 'no_data');
});

test('two currencies in one run are two totals rows, never added', async () => {
  set({ useCases: ['A', 'B'], answersBySession: { 42: [saved('A', 1, 100, { calculated: true, currency: 'EUR' }), saved('B', 1, 50, { calculated: true, currency: 'USD' })] } });
  const { body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.deepEqual(body.run.totals.map((t) => [t.currency, t.amount]).sort(), [['EUR', 100], ['USD', 50]]);
});

test('only the latest version counts, an undo row included', async () => {
  set({ useCases: ['A'], answersBySession: { 42: [saved('A', 1, 1000000, { calculated: true }), saved('A', 2, 2000000, { calculated: true })] } });
  assert.equal(usd((await get(`/api/inspire/value/totals?${QUERY}&session_id=42`)).body.run.totals).amount, 2000000);
  state.answersBySession[42].push(saved('A', 3, 1000000, { calculated: true }));
  assert.equal(usd((await get(`/api/inspire/value/totals?${QUERY}&session_id=42`)).body.run.totals).amount, 1000000);
});

test('all runs: one row per run and all.totals is their sum', async () => {
  set({ useCases: ['A'], sessions: [['41', 'One', '2026-11-01'], ['42', 'Two', '2026-11-02'], ['43', 'Three', '2026-11-03']],
    answersBySession: { 41: [saved('A', 1, 100, { calculated: true })], 42: [saved('A', 1, 200)], 43: [saved('A', 1, 300, { calculated: true })] } });
  const { status, body } = await get(`/api/inspire/value/totals?${QUERY}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.runs.map((r) => [r.session_id, r.name, r.created_at]), [['41', 'One', '2026-11-01'], ['42', 'Two', '2026-11-02'], ['43', 'Three', '2026-11-03']]);
  assert.deepEqual(usd(body.all.totals), { currency: 'USD', amount: 600, calculated: 400, estimated: 200 });
  assert.equal(body.all.n_calculated, 2);
  assert.equal(body.all.n_estimated, 1);
  assert.ok(!body.truncated);
});

test('more sessions than the cap sets truncated and reads only the cap', async () => {
  set({ useCases: ['A'], sessions: Array.from({ length: CAP + 1 }, (_, i) => [String(100 + i), `R${i}`, '2026-11-01']) });
  const { body } = await get(`/api/inspire/value/totals?${QUERY}`);
  assert.equal(body.truncated, true);
  assert.equal(body.runs.length, CAP);
});

test('by_verb sums per currency and verb', async () => {
  set({ useCases: ['A', 'B', 'C'], answersBySession: { 42: [saved('A', 1, 10, { calculated: true, verb: 'REDUCE COST' }), saved('B', 1, 5, { verb: 'REDUCE COST' }),
    saved('C', 1, 7, { calculated: true, verb: 'GROW REVENUE' })] } });
  const { body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  const key = (r) => `${r.currency}|${r.verb}`;
  assert.deepEqual(body.run.by_verb.map((r) => [key(r), r.amount]).sort(), [['USD|GROW REVENUE', 7], ['USD|REDUCE COST', 15]]);
});

test('a non-numeric session_id is 400', async () => {
  const { status } = await get(`/api/inspire/value/totals?${QUERY}&session_id=abc`);
  assert.equal(status, 400);
});
