const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');

const NOT_PART = 'Not part of this demo.';
const ALL = S.loadShowcases();
const without = (answers, route) => Object.fromEntries(Object.entries(answers).filter(([key]) => key.replace(/\?.*$/, '').replace(/ \{.*$/, '') !== route));

function demoBundle(id, mvpApi) {
  return { version: 1, id, title: id, business: id, session_id: '1001', summary: '', inspire: ALL['kinds-retail'].inspire, mvps: { N01: { title: 'Lapse call list', api: mvpApi } } };
}

async function serve(bundles) {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'showcase-screens-'));
  for (const b of bundles) require('node:fs').writeFileSync(require('node:path').join(dir, `${b.id}.json`), JSON.stringify(b));
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { dir, shellFiles: { 'static/index.html': '<html>' }, log: { error: () => {} } });
  const srv = await listen(app);
  return { srv, close: async () => { await srv.close(); require('node:fs').rmSync(dir, { recursive: true, force: true }); } };
}

async function call(base, method, url, body) {
  const resp = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

const app = (base, id, mvp) => call(base, 'GET', `/showcase/${id}/mvp/${mvp}/api/app`);
const myWork = (base, id, mvp, window = 'week') => call(base, 'POST', `/showcase/${id}/mvp/${mvp}/api/my_work`, { page: 'n01_u01', window });

test('kinds-retail keeps every screen and its My work periods, answered from the recording', async () => {
  const { srv, close } = await serve([ALL['kinds-retail']]);
  try {
    const shell = (await app(srv.url, 'kinds-retail', 'N01-U01')).data;
    assert.equal(shell.screens.performance, true);
    assert.equal(shell.screens.impact, true);
    assert.equal(shell.screens.runs, true);
    assert.equal(shell.screens.feedback, undefined);
    for (const window of ['today', 'week', 'month', 'all']) {
      const work = await myWork(srv.url, 'kinds-retail', 'N01-U01', window);
      assert.equal(work.status, 200, window);
      assert.ok(work.data.pages, window);
    }
  } finally {
    await close();
  }
});

for (const id of ['nyctaxi', 'tpcds-retail']) {
  test(`${id}: a demo MVP without a recorded My work route hides My work and never answers it with a 404 page`, async () => {
    const { srv, close } = await serve([demoBundle(id, without(ALL['kinds-retail'].mvps['N01-U01'].api, 'POST /api/my_work'))]);
    try {
      const shell = (await app(srv.url, id, 'N01')).data;
      assert.equal(shell.screens.performance, false);
      const work = await myWork(srv.url, id, 'N01');
      assert.equal(work.status, 404);
      assert.equal(work.data.error, NOT_PART);
      assert.equal(work.data.showcase, true);
    } finally {
      await close();
    }
  });
}

test('a demo MVP without recorded Impact, Runs, Feedback or Alerts hides those sections', async () => {
  const api = without(without(without(without(ALL['kinds-retail'].mvps['N01-U01'].api, 'GET /api/impact'), 'GET /api/runs'), 'GET /api/feedback'), 'GET /api/alerts');
  const bundle = demoBundle('bare', { ...api, 'GET /api/app': { status: 200, body: { ...api['GET /api/app'].body, alerting: { on: true } } } });
  const { srv, close } = await serve([bundle]);
  try {
    const shell = (await app(srv.url, 'bare', 'N01')).data;
    assert.equal(shell.screens.impact, false);
    assert.equal(shell.screens.runs, false);
    assert.equal(shell.screens.feedback, false);
    assert.equal(shell.alerting.on, false);
    assert.equal(shell.screens.performance, true);
  } finally {
    await close();
  }
});

test('gatedApp leaves an app whose recording holds every route exactly as recorded', () => {
  const body = ALL['kinds-retail'].mvps['N01-U01'].api['GET /api/app'].body;
  assert.deepEqual(S.gatedApp(body, ALL['kinds-retail'].mvps['N01-U01'].api), body);
});

test('the real recordings: nyctaxi and tpcds carry no MVP, so no My work is offered from them', () => {
  assert.deepEqual(ALL.nyctaxi.mvps, {});
  assert.deepEqual(ALL['tpcds-retail'].mvps, {});
});
