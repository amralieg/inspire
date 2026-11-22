// FX-37 (D20): the value planner sent temperature 0, which the newest chat models refuse with HTTP 400 ("does not support the temperature
// parameter"), so every Calculate path had no plan. Every chat body must carry only what those endpoints accept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeApp, listen } = require('./support/implementApp');

const COLUMNS = [{ column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 }];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
// FX-51 (REQ-448): the plan's own default value is 1,000,000 a year, inside the 100K-100M range, so the one range retry never fires and the call count stays 1.
const PLAN = { case_noun: 'order', case_filter: null, groupings: [], metrics: [], drivers: [{ id: 'revenue_uplift', label: 'Uplift', on: true, why: 'more sales', asks: [
  { id: 'base_revenue_per_year', source: 'estimate', default: 1000000, why: 'a guess' }, { id: 'uplift_pct', source: 'estimate', default: 100, why: 'a guess' }] }] };

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

test('the case plan call sends a body an endpoint that refuses temperature accepts', async () => {
  const bodies = [];
  const got = await planWith(({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    // REQ-472: anchor and review calls are answered apart from the plan call.
    const first = String(body.messages[0].content);
    if (/^You anchor/.test(first)) return [{ choices: [{ message: { content: '{}' } }] }, 200];
    if (/^You review/.test(first)) return [{ choices: [{ message: { content: JSON.stringify({ approved: true, amount: 0, reason: 'ok' }) } }] }, 200];
    bodies.push(body);
    if ('temperature' in body) return [{ message: 'Model global.anthropic.claude-opus-5-5 does not support the temperature parameter.' }, 400];
    return [{ choices: [{ message: { content: JSON.stringify(PLAN) } }] }, 200];
  });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.model, 'chat-new', `model_reason: ${got.data.plan.model_reason}`);
  assert.equal(bodies.length, 1);
});

test('a refused model names the action to take, not a bare failure', async () => {
  const got = await planWith(({ path: p }) => (p.endsWith('/chat-new/invocations') ? [{ message: 'denied' }, 403] : undefined));
  assert.equal(got.data.plan.model, null);
  assert.match(got.data.plan.model_reason, /chat-new/);
  assert.match(got.data.plan.model_reason, /Can query|CAN_QUERY|EXECUTE/i);
});

test('closing grep: no chat call in the backend sends temperature', () => {
  const files = [path.join(__dirname, '..', 'implementRoutes.js'), path.join(__dirname, '..', 'lib', 'modelAccess.js')];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /temperature\s*:/, f);
});
