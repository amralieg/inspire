// REQ-439 (C6): the run and all-runs value totals include the saved Calculate values. Latest version per use case, per currency, never converted.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startInspire } = require('./support/serverProcess');
const VT = require('../lib/valueTotals');

const ANSWER_COLUMNS = ['use_case_id', 'version', 'answers', 'yearly', 'saved_at', 'saved_by', 'note'];
const QUERY = 'inspire_database=c.s&warehouse_id=w1';
const CAP = 20;

const saved = (id, version, amount, { shape = 2, calculated = false, currency = 'USD', verb = 'REDUCE COST' } = {}) => [
  id, String(version), JSON.stringify(shape ? { shape, currency, calculated, plan: { basis: 'use_case', use_case_id: id } } : { currency }), // FX-34: a current estimate carries its own plan basis
  JSON.stringify({ verb, calculated, estimated: !calculated, currency, total: { unit: currency, amount }, parts: [{ id: 'p', verb, amount }] }), '2026-11-21 10:00:00', 'p@example.com', '',
];
const RULE = { use_case_name: 'App', money: { currency: 'convert', base: 'USD', value: { method: 'fixed', amount: 50, currency: 'USD' } }, config: { result_table: 'c.s.orders' } };

// answersBySession: { '42': [rows of every version] }. Like the real table, the latest version per use case is read.
function fakeWarehouse(state) {
  // The list form (`session_id IN (...)`) answers the rows of every listed session, each led by its session_id column.
  const sidsOf = (sql) => { const m = /session_id IN \(([^)]*)\)/.exec(sql); return m ? m[1].split(',').map((x) => x.replace(/['\s]/g, '')) : null; };
  const answer = (sql, parameters) => {
    const bound = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    const listed = sql.includes('session_id IN (') ? (sql.includes('__inspire_value_answers') ? Object.values(bound).map(String) : sidsOf(sql)) : null;
    if (listed && !sql.includes('ORDER BY create_at DESC')) {
      const per = (rowsOf) => listed.flatMap((sid) => rowsOf(sid).map((row) => [sid, ...row]));
      if (sql.includes('__inspire_value_answers')) {
        return { columns: ['session_id', ...ANSWER_COLUMNS], rows: per((sid) => {
          const latest = new Map();
          for (const row of (state.answersBySession[sid] || [])) {
            if (!latest.has(row[0]) || Number(row[1]) > Number(latest.get(row[0])[1])) latest.set(row[0], row);
          }
          return [...latest.values()];
        }) };
      }
      if (sql.includes('primary_table FROM')) return { columns: ['session_id', 'id', 'primary_table'], rows: per(() => state.useCases.map((id) => [id, state.noTable.includes(id) ? '' : 'c.s.orders'])) };
      if (sql.includes('business_domain')) return { columns: ['session_id', 'id', 'business_domain', 'value_estimate'], rows: per(() => state.useCases.map((id) => [id, 'D', null])) };
      if (sql.includes('ORDER BY spec_version')) return { columns: ['session_id', 'use_case_id', 'spec'], rows: per(() => (state.useCases.includes('C') ? [['C', JSON.stringify(RULE)]] : [])) };
      return { columns: ['session_id', 'x'], rows: [] };
    }
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
      state.sent.push({ sql: String(sent.statement || ''), parameters });
      const { columns, rows } = answer(String(sent.statement || ''), parameters);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ statement_id: 's', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) }, total_chunk_count: 1 }, result: { data_array: rows } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const state = { answersBySession: {}, sessions: [], useCases: [], noTable: [], sent: [] };
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

// REQ-497 FX-103: a value accepted with "Accept and save" reads back from the totals as calculated, in the one-run read and the all-runs read.
test('an accepted 60K value is calculated in the one-run totals', async () => {
  set({ useCases: ['A'], answersBySession: { 42: [saved('A', 1, 60000, { calculated: true })] } });
  const { body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.equal(body.use_cases.A.status, 'calculated', JSON.stringify(body.use_cases.A));
});

test('a value accepted after an earlier provisional save is calculated', async () => {
  set({ useCases: ['A'], answersBySession: { 42: [saved('A', 1, 60000), saved('A', 2, 60000, { calculated: true })] } });
  const { body } = await get(`/api/inspire/value/totals?${QUERY}&session_id=42`);
  assert.equal(body.use_cases.A.status, 'calculated', JSON.stringify(body.use_cases.A));
});
