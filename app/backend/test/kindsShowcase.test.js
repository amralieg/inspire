const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');
const { SHOWCASE_MAX_BYTES, showcaseLeaks } = require('../lib/showcaseRecord');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../lib/appShell');

const kinds = () => import('../../scripts/kindsShowcase.mjs');
const FILE = path.join(S.SHOWCASE_DIR, 'kinds-retail.json.gz');
const bundle = () => S.loadShowcases()['kinds-retail'];
const useCases = (b) => b.inspire[`GET /api/inspire/usecases?session_id=${b.session_id}`].body.usecases;
const answersOf = (mvp) => Object.entries(mvp.api);

async function serve() {
  const reached = [];
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { shellFiles: appShellFiles(appShellPayload(bundledAppShellText())), log: { error: (m) => { throw new Error(m); } } });
  app.all('/api/*rest', (req, res) => { reached.push(`${req.method} ${req.path}`); res.json({ real: true }); });
  app.all('/showcase/*rest', (req, res) => { reached.push(`${req.method} ${req.path}`); res.status(418).json({ real: true }); });
  return { srv: await listen(app), reached };
}

async function call(base, url, { method = 'GET', body } = {}) {
  const resp = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const type = resp.headers.get('content-type') || '';
  return { status: resp.status, data: type.includes('json') ? await resp.json() : await resp.text() };
}

test('the kinds demo is the first demo, opens with its use cases, and fits the size the App allows', () => {
  assert.equal(S.showcaseProblem(bundle(), FILE), '');
  assert.equal(Object.keys(S.loadShowcases())[0], 'kinds-retail');
  assert.ok(fs.statSync(FILE).size < SHOWCASE_MAX_BYTES, `${fs.statSync(FILE).size} bytes`);
  assert.deepEqual(showcaseLeaks(bundle(), ['databricksapps.com', '127.0.0.1', 'amr', 'Amr']), []);
});

test('every use case of the kinds demo has its own kind, a name without the technique, and the title the one formatter writes', async () => {
  const { USE_CASES } = await kinds();
  const rows = useCases(bundle());
  assert.deepEqual(rows.map((u) => u.id), [...USE_CASES].map((u) => u.no).sort((a, b) => rows.findIndex((r) => r.id === a) - rows.findIndex((r) => r.id === b)));
  assert.equal(new Set(rows.map((u) => u.use_case_kind)).size, rows.length);
  for (const u of rows) {
    const source = USE_CASES.find((x) => x.no === u.id);
    assert.equal(u.use_case_kind, source.kind, u.id);
    assert.equal(u.Name, source.name, u.id);
    assert.equal(u.use_case, source.headline, `${u.id} keeps the old headline in use_case`);
    assert.equal(u['Analytics Technique'], source.technique, u.id);
    assert.ok(!u.Name.toLowerCase().includes(source.technique.toLowerCase()), `${u.id} keeps the technique out of the name`);
    assert.equal(u.name_with_technique, `${u.Name} using ${source.technique.toLowerCase()}`, u.id);
    for (const field of ['serving_summary', 'method_summary', 'value_source', 'kind_family', 'app_layout']) assert.ok(String(u[field] || '').trim(), `${u.id} ${field}`);
    assert.doesNotMatch(JSON.stringify([u.Name, u.use_case, u.serving_summary, u.method_summary, u.value_source]), /[\u2013\u2014]/, `${u.id} has no dash`);
  }
});

test('every use case of the kinds demo has its MVP App, laid out for its kind, with a recorded Genie answer marked as a demo answer', async () => {
  const { DEMO_LAYOUTS, DEMO_RECORDED, USE_CASES } = await kinds();
  const b = bundle();
  assert.deepEqual(Object.keys(b.mvps).sort(), USE_CASES.map((u) => u.no).sort());
  const layouts = new Set();
  for (const u of USE_CASES) {
    const mvp = b.mvps[u.no];
    const app = mvp.api['GET /api/app'];
    assert.equal(app.status, 200, u.no);
    assert.equal(app.body.pages.length, 1, u.no);
    assert.equal(app.body.pages[0].layout.id, u.mvp.layout, u.no);
    layouts.add(app.body.pages[0].layout.id);
    const asked = answersOf(mvp).filter(([key]) => key.startsWith('POST /api/genie/ask '));
    assert.ok(asked.length >= u.genie.length, `${u.no} recorded the suggested questions`);
    for (const g of u.genie) assert.ok(asked.some(([key]) => JSON.parse(key.slice(key.indexOf('{'))).question === g.q), `${u.no} recorded "${g.q}"`);
    const said = answersOf(mvp).filter(([key]) => key.startsWith('GET /api/genie/message'));
    assert.ok(said.length >= u.genie.length, u.no);
    for (const [key, answer] of said) {
      assert.equal(answer.body.state, 'done', key);
      assert.ok(answer.body.text.endsWith(DEMO_RECORDED), `${u.no} ${key} says it is a demo answer`);
      assert.doesNotMatch(answer.body.text, /[*_]{2}|^_|_$/m, `${u.no} ${key} is plain text`);
    }
  }
  assert.deepEqual([...layouts].sort(), [...DEMO_LAYOUTS].sort());
});

test('the Inspire App hosts each kinds demo MVP App: the shell, its reads and Genie come from the file, and a change is refused', async () => {
  const { USE_CASES } = await kinds();
  const { srv, reached } = await serve();
  try {
    for (const u of USE_CASES) {
      const base = `/showcase/kinds-retail/mvp/${u.no}`;
      const page = await call(srv.url, `${base}/`);
      assert.equal(page.status, 200, u.no);
      assert.match(page.data, /<div id="root">|<script/, u.no);
      const app = await call(srv.url, `${base}/api/app`);
      assert.equal(app.status, 200, u.no);
      assert.equal(app.data.pages[0].layout.id, u.mvp.layout, u.no);
      const id = app.data.pages[0].id;
      const ask = await call(srv.url, `${base}/api/genie/ask`, { method: 'POST', body: { page: id, question: u.genie[0].q } });
      assert.equal(ask.status, 200, u.no);
      const said = await call(srv.url, `${base}/api/genie/message?page=${id}&message_id=${ask.data.message_id}&conversation_id=${ask.data.conversation_id}`);
      assert.equal(said.status, 200, u.no);
      assert.ok(said.data.text.startsWith(u.genie[0].a), u.no);
      const work = await call(srv.url, `${base}/api/my_work`, { method: 'POST', body: { window: 'week', time_zone: 'Pacific/Auckland' } });
      assert.equal(work.status, 200, `${u.no} My work replays in any time zone`);
      const change = await call(srv.url, `${base}/api/records/act`, { method: 'POST', body: { page: id, keys: ['K1'], action: 'fixed' } });
      assert.deepEqual([change.status, change.data.error], [403, S.SHOWCASE_READ_ONLY], u.no);
    }
    assert.deepEqual(reached, []);
  } finally {
    await srv.close();
  }
});

test('the demo answers My work and Scenario lab reads, and replays the same answer whatever time zone or Genie conversation the browser sends', () => {
  assert.equal(S.showcaseCanRead('POST', '/api/my_work'), true);
  assert.equal(S.showcaseCanRead('POST', '/api/scenario/evaluate'), true);
  assert.equal(S.showcaseCanRead('POST', '/api/records/act'), false);
  assert.equal(S.showcaseKey('POST', '/api/my_work', {}, { window: 'week', time_zone: 'Asia/Dubai' }), S.showcaseKey('POST', '/api/my_work', {}, { window: 'week', time_zone: 'UTC' }));
  assert.notEqual(S.showcaseKey('POST', '/api/my_work', {}, { window: 'week' }), S.showcaseKey('POST', '/api/my_work', {}, { window: 'month' }));
  assert.equal(S.showcaseKey('GET', '/api/genie/message', { message_id: 'm1', conversation_id: 'c1' }), S.showcaseKey('GET', '/api/genie/message', { message_id: 'm1', conversation_id: 'c2' }));
});
