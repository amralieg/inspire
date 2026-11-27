// C28 (REQ-572 follow-up): POST /api/inspire/docs/translate with language English. No vibe: the texts come back as they are, no model call.
// With a vibe: one rewrite call per chunk that holds the vibe and tells the model to rewrite in English, keeping numbers, names and {n} holes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const GEN = '/Workspace/Users/me@example.com/inspire_out';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: GEN, table_scope: JSON.stringify({}) };
const ENDPOINTS = { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] };
const BASE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', language: 'English' };

function harness(reply) {
  const asked = [];
  const workspace = ({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    asked.push(body);
    const out = reply(body);
    return out === null ? [{ error: 'down' }, 500] : [{ choices: [{ finish_reason: 'stop', message: { content: out } }] }, 200];
  };
  return { made: makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], workspace, responses: ENDPOINTS }), asked };
}
async function post(h, extra) {
  const srv = await listen(h.made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/docs/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' }, body: JSON.stringify({ ...BASE, ...extra }) });
    const text = await resp.text();
    let data = text; try { data = JSON.parse(text); } catch (_) { /* plain text */ }
    return { status: resp.status, data };
  } finally { await srv.close(); }
}
const TEXTS = { 'story|exec|0': 'We found 12 use cases for Acme worth {0} a year.', 'story|exec|1': 'Start with the top three.' };

test('English with a vibe: one rewrite call holding the vibe, the English rewrite instruction and every key; the rewrite is returned', async () => {
  const h = harness(() => JSON.stringify({ 'story|exec|0': 'Twelve use cases, {0} a year, for Acme.', 'story|exec|1': 'Begin with the top three.' }));
  const r = await post(h, { texts: TEXTS, vibe: 'Board-level tone' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(h.asked.length, 1);
  const system = h.asked[0].messages[0].content;
  assert.match(system, /Board-level tone/);
  assert.match(system, /rewrite/i); assert.match(system, /English/); assert.doesNotMatch(system, /translate short/i);
  assert.deepEqual(Object.keys(JSON.parse(h.asked[0].messages[1].content)), Object.keys(TEXTS));
  assert.equal(r.data.texts['story|exec|0'], 'Twelve use cases, {0} a year, for Acme.');
  assert.equal(r.data.untranslated, undefined);
});

test('English with no vibe (or a blank one): the texts come back as sent and no model is called', async () => {
  const h = harness(() => { throw new Error('no model call expected'); });
  for (const vibe of [undefined, '', '   ']) {
    const r = await post(h, { texts: TEXTS, vibe });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.texts, TEXTS);
  }
  assert.equal(h.asked.length, 0);
});

test('English with a vibe and a model that fails: 200 with the source texts named in untranslated, never an error', async () => {
  const h = harness(() => null);
  const r = await post(h, { texts: TEXTS, vibe: 'Board-level tone' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.texts, TEXTS);
  assert.deepEqual([...r.data.untranslated].sort(), Object.keys(TEXTS).sort());
});
