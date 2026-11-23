// D-aws-05: the run review (/api/inspire/value/run-review) asked a reasoning model for 800 tokens; its thinking used them and the JSON was cut off.
// Here the model is cut off (finish_reason length) below 2000 tokens; with room the run is AI checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ROOM = 2000;
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const ENDPOINTS = { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] };
const ANCHOR = { low: 100000, high: 5000000, typical: 500000, business_revenue_estimate: 200000000, reason: 'typical' };
const RUN = { run_total: 400000, scales: { 'N01-U01': 0.5 }, reason: 'Half is shared.' };
const ROW = { use_case_id: 'N01-U01', version: '1', answers: '{}', saved_at: '2026-01-01', saved_by: 'p@example.com', note: '',
  yearly: JSON.stringify({ verb: 'REDUCE COST', total: { unit: 'USD', amount: 800000 }, currency: 'USD' }) };

test('the run review of a reasoning model has room for its answer, so the run is AI checked', async () => {
  const asked = [];
  const model = ({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    const first = String(body.messages[0].content);
    const kind = /^You anchor/.test(first) ? 'anchor' : /^You review the yearly value of every use case/.test(first) ? 'run' : 'other';
    asked.push([kind, body.max_tokens]);
    const full = JSON.stringify(kind === 'anchor' ? ANCHOR : RUN);
    if (!(body.max_tokens >= ROOM)) return [{ choices: [{ finish_reason: 'length', message: { content: full.slice(0, 20) } }] }, 200];
    return [{ choices: [{ finish_reason: 'stop', message: { content: full } }] }, 200];
  };
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], workspace: model, responses: ENDPOINTS,
    statements: { __inspire_value_answers: (sql) => (sql.includes('ROW_NUMBER') ? { rows: [ROW] } : { rows: [] }) } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/run-review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' }) });
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.ok(asked.some(([k]) => k === 'run'), `the run review was never asked: ${JSON.stringify(asked)}`);
    assert.equal(data.review.ai_checked, true, `asked ${JSON.stringify(asked)}; ${JSON.stringify(data)}`);
    assert.equal(data.review.reason, RUN.reason);
  } finally {
    await srv.close();
  }
});
