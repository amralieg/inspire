// C24 (RC7-B-09): POST /api/inspire/docs/translate never answers 502 for a reply it can use. It reads fenced JSON, JSON with prose (and braces)
// around it and a reply cut off mid-way, splits a long payload into several model calls, asks once more when a reply is unusable, and keeps the
// source text (named in `untranslated`) for a field that still fails, instead of failing the whole file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const GEN = '/Workspace/Users/me@example.com/inspire_out';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: GEN, table_scope: JSON.stringify({}) };
const ENDPOINTS = { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] };
const BASE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };

// reply(body, n) returns the raw text of the n-th model call (0-based); finish is the finish_reason.
function harness(reply, finish = 'stop') {
  const asked = [];
  const workspace = ({ path: p, body }) => {
    if (!p.endsWith('/chat-new/invocations')) return undefined;
    const n = asked.length;
    asked.push(body);
    const out = reply(body, n);
    return [{ choices: [{ finish_reason: typeof out === 'object' && out.finish ? out.finish : finish, message: { content: typeof out === 'object' ? out.text : out } }] }, 200];
  };
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], workspace, responses: ENDPOINTS });
  return { made, asked };
}
async function translate(h, texts) {
  const srv = await listen(h.made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/docs/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' }, body: JSON.stringify({ ...BASE, language: 'Arabic', texts }) });
    const text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: resp.status, data };
  } finally {
    await srv.close();
  }
}
const sent = (body) => JSON.parse(body.messages[body.messages.length - 1].content);

test('B-09 a reply in a ```json fence is read', async () => {
  const h = harness(() => '```json\n{"a": "توقع فقدان العملاء", "b": "قيمة"}\n```');
  const r = await translate(h, { a: 'Predict churn', b: 'Value' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.texts, { a: 'توقع فقدان العملاء', b: 'قيمة' });
  assert.equal(r.data.untranslated, undefined);
});

test('B-09 prose with braces before and after the JSON does not stop the read', async () => {
  const h = harness(() => 'Sure! Here is the {translation} you asked for:\n{"a": "قيمة {0} سنوياً", "b": "نص"}\nLet me know if you need {anything} else.');
  const r = await translate(h, { a: 'Value {0} a year', b: 'Text' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.texts, { a: 'قيمة {0} سنوياً', b: 'نص' });
});

test('B-09 a reply cut off mid-way keeps the fields it finished and names the rest', async () => {
  const h = harness(() => ({ text: '{"a": "ترجمة كاملة", "b": "نص طويل جدا لم ينته', finish: 'length' }));
  const r = await translate(h, { a: 'Full text', b: 'A very long text that is cut' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.texts.a, 'ترجمة كاملة');
  assert.equal(r.data.texts.b, 'A very long text that is cut', 'the unfinished field keeps its source text');
  assert.deepEqual(r.data.untranslated, ['b']);
});

test('B-09 a long payload is split into several model calls, each small, and every key comes back translated', async () => {
  const texts = {};
  for (let i = 0; i < 40; i += 1) texts[`k${i}`] = `Source sentence number ${i} ${'x'.repeat(500)}`;
  const h = harness((body) => JSON.stringify(Object.fromEntries(Object.keys(sent(body)).map((k) => [k, `ع ${k}`]))));
  const r = await translate(h, texts);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(h.asked.length > 1, `more than one model call, got ${h.asked.length}`);
  for (const body of h.asked) assert.ok(JSON.stringify(sent(body)).length <= 8000, 'each call carries a bounded chunk');
  assert.deepEqual(Object.keys(r.data.texts).sort(), Object.keys(texts).sort());
  assert.ok(Object.entries(r.data.texts).every(([k, v]) => v === `ع ${k}`), 'every key is the model translation');
  assert.equal(r.data.untranslated, undefined);
});

test('B-09 an unusable first reply is asked once more, and the second reply is used', async () => {
  const h = harness((body, n) => (n === 0 ? 'I am sorry, I cannot do that.' : '{"a": "مرحبا"}'));
  const r = await translate(h, { a: 'Hello' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(h.asked.length, 2, 'one retry');
  assert.deepEqual(r.data.texts, { a: 'مرحبا' });
});

test('B-09 two unusable replies give the source texts back with every key named, never a 502', async () => {
  const h = harness(() => 'No JSON here at all.');
  const texts = { a: 'Hello', b: 'World' };
  const r = await translate(h, texts);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(h.asked.length, 2, 'asked once and retried once, not more');
  assert.deepEqual(r.data.texts, texts);
  assert.deepEqual([...r.data.untranslated].sort(), ['a', 'b']);
});

test('B-09 only a failed chunk keeps its source text; the other chunks are translated', async () => {
  const texts = {};
  for (let i = 0; i < 40; i += 1) texts[`k${i}`] = `Source ${i} ${'y'.repeat(500)}`;
  let firstKey = null;
  const h = harness((body) => {
    const keys = Object.keys(sent(body));
    if (firstKey === null) firstKey = keys[0];
    if (keys.includes(firstKey)) return 'garbage';
    return JSON.stringify(Object.fromEntries(keys.map((k) => [k, `ع ${k}`])));
  });
  const r = await translate(h, texts);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.untranslated.includes(firstKey) && r.data.untranslated.length < 40, 'only the failed chunk is untranslated');
  assert.equal(r.data.texts[firstKey], texts[firstKey]);
  assert.equal(r.data.texts.k39, 'ع k39');
});
