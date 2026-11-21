// REQ-440 (B3): a use case whose MVP measured money in the ledger is "measured" in the value totals, ahead of saved answers and estimates.
// Its amount is the measured yearly (the same builder GET /api/inspire/value/yearly uses).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startInspire } = require('./support/serverProcess');

const ANSWER_COLUMNS = ['use_case_id', 'version', 'answers', 'yearly', 'saved_at', 'saved_by', 'note'];
const QUERY = 'inspire_database=c.s&warehouse_id=w1';
const SPEC = JSON.stringify({ use_case_name: 'App', config: { result_table: 'c.s.orders_out' } });

const saved = (id, amount) => [
  id, '1', JSON.stringify({ shape: 2, currency: 'USD', calculated: true }),
  JSON.stringify({ verb: 'REDUCE COST', calculated: true, estimated: false, currency: 'USD', total: { unit: 'USD', amount }, parts: [{ id: 'p', verb: 'REDUCE COST', amount }] }),
  '2026-11-21 10:00:00', 'p@example.com', '',
];
// 10,000 of money measured on 100 records, 10,000 eligible records over 73 days of data: 10,000 / 100 * 10,000 * 5 = 5,000,000 a year.
const stake = (id, amount) => [id, 'money', 'USD', null, String(amount), '1'];

function fakeWarehouse(state) {
  const answer = (sql, parameters) => {
    const bound = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    // The list form (`session_id IN (...)`) answers every listed session, each row led by its session_id.
    const m = /session_id IN \(([^)]*)\)/.exec(sql);
    if (m) {
      const listed = sql.includes('__inspire_value_answers') ? Object.values(bound).map(String) : m[1].split(',').map((x) => x.replace(/['\s]/g, ''));
      const per = (rowsOf) => listed.flatMap((sid) => rowsOf(sid).map((row) => [sid, ...row]));
      if (sql.includes('__inspire_value_ledger')) return { columns: ['session_id', 'part', 'use_case_id', 'kind', 'currency', 'unit', 'amount', 'measured'], rows: per((sid) => (state.ledgerBySession[sid] || []).map((r) => ['stake', ...r])) };
      if (sql.includes('__inspire_value_answers')) return { columns: ['session_id', ...ANSWER_COLUMNS], rows: per((sid) => state.answersBySession[sid] || []) };
      if (sql.includes('primary_table FROM')) return { columns: ['session_id', 'id', 'primary_table'], rows: per(() => state.useCases.map((id) => [id, 'c.s.orders'])) };
      if (sql.includes('business_domain')) return { columns: ['session_id', 'id', 'business_domain', 'value_estimate'], rows: per(() => state.useCases.map((id) => [id, 'D', null])) };
      if (sql.includes('ORDER BY spec_version')) return { columns: ['session_id', 'use_case_id', 'spec'], rows: per(() => state.useCases.map((id) => [id, SPEC])) };
    }
    if (sql.includes('__inspire_value_ledger')) {
      const sid = (/session_id = '(\d+)'/.exec(sql) || [])[1];
      return { columns: ['part', 'use_case_id', 'kind', 'currency', 'unit', 'amount', 'measured'], rows: (state.ledgerBySession[sid] || []).map((r) => ['stake', ...r]) };
    }
    if (sql.includes('__inspire_value_answers')) {
      const sid = Object.values(bound)[0];
      return { columns: ANSWER_COLUMNS, rows: state.answersBySession[sid] || [] };
    }
    if (sql.includes('ORDER BY create_at DESC')) return { columns: ['session_id', 'business_name', 'create_at'], rows: state.sessions };
    if (sql.includes('processing_status')) return { columns: ['session_id', 'table_scope'], rows: [['42', '{}']] };
    if (sql.includes('primary_table FROM')) return { columns: ['id', 'primary_table'], rows: state.useCases.map((id) => [id, 'c.s.orders']) };
    if (sql.includes('SELECT id, business_domain')) return { columns: ['id', 'business_domain', 'value_estimate'], rows: state.useCases.map((id) => [id, 'D', null]) };
    if (sql.includes('PARTITION BY use_case_id ORDER BY spec_version')) return { columns: ['use_case_id', 'spec'], rows: state.useCases.map((id) => [id, SPEC]) };
    if (sql.includes('SELECT records, kpi_name')) return { columns: ['records', 'kpi_name', 'kpi_direction'], rows: [['100', 'cost', 'decrease']] };
    if (sql.includes('information_schema.columns')) return { columns: ['column_name', 'data_type', 'ordinal_position'], rows: [['order_date', 'DATE', '1']] };
    if (sql.includes('AS eligible')) return { columns: ['eligible', 'days'], rows: [['10000', '73']] };
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

const state = { answersBySession: {}, ledgerBySession: {}, sessions: [], useCases: [] };
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
  const text = await resp.text();
  return { status: resp.status, text, body: JSON.parse(text) };
};
const set = (patch) => Object.assign(state, { answersBySession: {}, ledgerBySession: {}, sessions: [], useCases: [] }, patch);

test('a run: A measured 5M, B calculated 3.2M, C nothing', async () => {
  set({ useCases: ['A', 'B', 'C'], ledgerBySession: { 42: [stake('A', 10000)] }, answersBySession: { 42: [saved('B', 3200000)] } });
  const { status, body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.use_cases.A.status, 'measured');
  assert.equal(body.use_cases.A.amount, 5000000);
  assert.equal(body.use_cases.A.currency, 'USD');
  assert.equal(body.use_cases.A.verb, 'REDUCE COST');
  assert.equal(body.use_cases.B.status, 'calculated');
  assert.notEqual(body.use_cases.C.status, 'measured');
  const usd = body.run.totals.find((t) => t.currency === 'USD');
  assert.equal(usd.measured, 5000000);
  assert.equal(usd.calculated, 3200000);
  assert.equal(usd.amount, usd.calculated + usd.estimated + usd.measured);
  assert.equal(body.run.n_measured, 1);
  assert.equal(body.run.n_calculated, 1);
});

test('measured wins over saved answers for the same use case, the amount is the ledger one', async () => {
  set({ useCases: ['A'], ledgerBySession: { 42: [stake('A', 10000)] }, answersBySession: { 42: [saved('A', 3200000)] } });
  const { body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.equal(body.use_cases.A.status, 'measured');
  assert.equal(body.use_cases.A.amount, 5000000);
  const usd = body.run.totals.find((t) => t.currency === 'USD');
  assert.deepEqual([usd.measured, usd.calculated, usd.estimated, usd.amount], [5000000, 0, 0, 5000000]);
  assert.deepEqual([body.run.n_measured, body.run.n_calculated], [1, 0]);
});

test('all runs: n_measured and the per-run measured add up', async () => {
  set({ useCases: ['A'], sessions: [['41', 'One', '2026-11-01'], ['42', 'Two', '2026-11-02'], ['43', 'Three', '2026-11-03']],
    ledgerBySession: { 41: [stake('A', 10000)], 43: [stake('A', 20000)] }, answersBySession: { 42: [saved('A', 300)] } });
  const { status, body } = await get(`/api/inspire/value/totals?${QUERY}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.runs.map((r) => r.n_measured), [1, 0, 1]);
  assert.equal(body.all.n_measured, 2);
  const usd = (totals) => totals.find((t) => t.currency === 'USD');
  assert.equal(usd(body.runs[0].totals).measured, 5000000);
  assert.equal(usd(body.runs[2].totals).measured, 10000000);
  // Both runs measured the same table: one pool of money, the larger measurement counts once (REQ-454).
  assert.equal(usd(body.all.totals).measured, 10000000);
  assert.equal(usd(body.all.totals).calculated, 300);
  assert.equal(usd(body.all.totals).amount, 10000300);
});

// The snapshot of the unchanged /value/yearly reply for the same fake warehouse (taken on the commit before this change).
const YEARLY_SNAPSHOT = '{"use_cases":{"A":{"verb":"REDUCE COST","period":"Per Year","estimated":true,"entries":[{"kind":"money","unit":"USD","amount":5000000}],"basis":{"sampled_records":100,"eligible_records":10000,"days":73}}},"disclaimer":"This value is a calculation from your data, not a validated business case. A specialist value team must verify and sign off every number before it is shared or used in a decision."}';
test('GET /api/inspire/value/yearly is byte-identical', async () => {
  set({ useCases: ['A'], ledgerBySession: { 42: [stake('A', 10000)] } });
  const { text } = await get(`/api/inspire/value/yearly?${QUERY}&session_id=42`);
  assert.equal(text, YEARLY_SNAPSHOT);
});
