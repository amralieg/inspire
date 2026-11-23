// FX-101 (D-aws-01): the case plan answered "The model reply was not a usable plan." on a gateway model. Two causes, both proven live:
// (1) the reply content is a list whose first part is a reasoning block, and the old reader joined that block as "[object Object]" in front of the JSON;
// (2) the reasoning counts against max_tokens, so a plan that is cut off (finish_reason length) does not fit in 1500.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const PLAN = { case_noun: 'order', case_filter: null, groupings: [], metrics: [], drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
  { id: 'base_revenue_per_year', source: 'estimate', default: 1000000, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 100, why: 'a guess' }] }] };
const PLAN_TEXT = JSON.stringify(PLAN);

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

const other = (body) => {
  const first = String(body.messages[0].content);
  if (/^You anchor/.test(first)) return [{ choices: [{ message: { content: '{}' } }] }, 200];
  if (/^You review/.test(first)) return [{ choices: [{ message: { content: JSON.stringify({ approved: true, amount: 0, reason: 'ok' }) } }] }, 200];
  return null;
};

test('a reply whose content starts with a reasoning block is still a usable plan', async () => {
  const got = await planWith(({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    return other(body) || [{ choices: [{ finish_reason: 'stop', message: { content: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: '', signature: 'abc' }] }, { type: 'text', text: PLAN_TEXT }] } }] }, 200];
  });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.model, 'chat-new', `model_reason: ${got.data.plan.model_reason}`);
});

test('a model that spends tokens reasoning gets room for the whole plan', async () => {
  const asked = [];
  const got = await planWith(({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    const o = other(body);
    if (o) return o;
    asked.push(body.max_tokens);
    // The live model used 1500 tokens and was cut at 1500 mid-JSON; with room it finishes.
    if (body.max_tokens <= 1500) return [{ choices: [{ finish_reason: 'length', message: { content: PLAN_TEXT.slice(0, 40) } }] }, 200];
    return [{ choices: [{ finish_reason: 'stop', message: { content: PLAN_TEXT } }] }, 200];
  });
  assert.ok(asked[0] > 1500, `plan max_tokens ${asked[0]}`);
  assert.equal(got.data.plan.model, 'chat-new', `model_reason: ${got.data.plan.model_reason}`);
});
