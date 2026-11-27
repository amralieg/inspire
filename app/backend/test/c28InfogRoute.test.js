// C28 (REQ-571): POST /api/inspire/docs/infographic-pick asks the App's model for the story of one use case as an infographic
// ({scenario, title, steps, outcomes, kpi}). The reply is validated against the scenario list; junk is asked once more, then refused with 502.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/Workspace/Users/me@example.com/out', table_scope: JSON.stringify({}) };
const ENDPOINTS = { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] };
const BASE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const UC = { Name: 'Predict churn', Statement: 'Customers leave without warning.', Solution: 'A model scores risk.', 'Business Value': 'Saves $2M a year.', 'Tables Involved': 'main.s.secret' };
const GOOD = { scenario: 'funnel', title: 'Keep customers', steps: [{ title: 'Collect', text: 'signals' }, 'Score'], outcomes: [{ title: 'Retain', text: 'more' }], kpi: { value: '$2M', label: 'a year' } };

function harness(replies) {
  const asked = [];
  const workspace = ({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    asked.push(body);
    const r = replies[Math.min(asked.length - 1, replies.length - 1)];
    return [{ choices: [{ finish_reason: 'stop', message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }] }, 200];
  };
  return { made: makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], workspace, responses: ENDPOINTS }), asked };
}
async function post(srv, body) {
  const resp = await fetch(`${srv.url}/api/inspire/docs/infographic-pick`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' }, body: JSON.stringify({ ...BASE, ...body }) });
  const text = await resp.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: resp.status, data };
}

test('a valid reply is returned as the pick; the prompt holds the use case, the vibe and the scenario list but not the tables', async () => {
  const h = harness([GOOD]);
  const srv = await listen(h.made.app);
  try {
    const r = await post(srv, { use_case: UC, vibe: 'bold and friendly', orientation: 'portrait' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.pick.scenario, 'funnel');
    assert.equal(r.data.pick.steps[1].title, 'Score');
    assert.equal(h.asked.length, 1);
    const prompt = JSON.stringify(h.asked[0].messages);
    assert.ok(prompt.includes('Predict churn') && prompt.includes('bold and friendly') && prompt.includes('hub_spokes') && prompt.includes('portrait'));
    assert.ok(!prompt.includes('main.s.secret'), 'tables are not sent to the model');
  } finally { await srv.close(); }
});

test('a chosen scenario is forced onto the reply (user input wins)', async () => {
  const h = harness([GOOD]);
  const srv = await listen(h.made.app);
  try {
    const r = await post(srv, { use_case: UC, scenario: 'timeline' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.pick.scenario, 'timeline');
    assert.ok(JSON.stringify(h.asked[0].messages).includes('timeline'));
  } finally { await srv.close(); }
});

test('a reply wrapped in prose or a code fence is read; junk is asked twice then refused with 502', async () => {
  const fenced = harness(['Here you go:\n```json\n' + JSON.stringify(GOOD) + '\n```']);
  const s1 = await listen(fenced.made.app);
  try { assert.equal((await post(s1, { use_case: UC })).status, 200); } finally { await s1.close(); }
  const junk = harness([{ scenario: 'nope', title: 'x', steps: [], outcomes: [] }, 'not json']);
  const s2 = await listen(junk.made.app);
  try {
    const r = await post(s2, { use_case: UC });
    assert.equal(r.status, 502, JSON.stringify(r.data));
    assert.equal(junk.asked.length, 2, 'one retry');
  } finally { await s2.close(); }
});

test('bad bodies are refused without asking the model, and no model gives 503', async () => {
  const h = harness([GOOD]);
  const srv = await listen(h.made.app);
  try {
    for (const [what, body] of [['no use case', {}], ['use case not an object', { use_case: 'x' }], ['no name', { use_case: { Statement: 'x' } }], ['unknown scenario', { use_case: UC, scenario: 'zzz' }],
      ['vibe not text', { use_case: UC, vibe: 5 }], ['vibe too long', { use_case: UC, vibe: 'x'.repeat(2001) }], ['bad orientation', { use_case: UC, orientation: 'square' }]]) {
      const r = await post(srv, body);
      assert.equal(r.status, 400, `${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    }
    assert.equal(h.asked.length, 0);
  } finally { await srv.close(); }
  const none = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], responses: { 'GET /api/2.0/serving-endpoints': [{ endpoints: [] }] } });
  const s3 = await listen(none.app);
  try { assert.equal((await post(s3, { use_case: UC })).status, 503); } finally { await s3.close(); }
});
