const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');

const NOT_PART = 'Not part of this demo.';
const ALL = S.loadShowcases();
const without = (answers, route) => Object.fromEntries(Object.entries(answers).filter(([key]) => key.replace(/\?.*$/, '').replace(/ \{.*$/, '') !== route));

const pageOf = (mvp) => mvp.toLowerCase().replace(/-/g, '_');
const routesOf = (api) => new Set(Object.keys(api).map((key) => key.replace(/\?.*$/, '').replace(/ \{.*$/, '')));
const FULL = ['POST /api/my_work', 'GET /api/impact', 'GET /api/runs'];
// the first recorded kinds MVP that holds My work, Impact and Runs
const KIND_MVP = Object.keys(ALL['kinds-retail'].mvps).find((id) => FULL.every((r) => routesOf(ALL['kinds-retail'].mvps[id].api).has(r)));
const KIND_API = ALL['kinds-retail'].mvps[KIND_MVP].api;
const firstMvp = (id) => Object.keys(ALL[id].mvps)[0];

// a copy of a recorded demo whose first MVP answers `mvpApi` instead of what it recorded
function demoBundle(id, mvpApi, mvp = firstMvp(id)) {
  const real = ALL[id];
  return { ...real, mvps: { [mvp]: { ...real.mvps[mvp], api: mvpApi } } };
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
const myWork = (base, id, mvp, window = 'week') => call(base, 'POST', `/showcase/${id}/mvp/${mvp}/api/my_work`, { page: pageOf(mvp), window });

test('kinds-retail keeps every screen and its My work periods, answered from the recording', async () => {
  const { srv, close } = await serve([ALL['kinds-retail']]);
  try {
    const shell = (await app(srv.url, 'kinds-retail', KIND_MVP)).data;
    assert.equal(shell.screens.performance, true);
    assert.equal(shell.screens.impact, true);
    assert.equal(shell.screens.runs, true);
    assert.equal(shell.screens.feedback, undefined);
    for (const window of ['today', 'week', 'month', 'all']) {
      const work = await myWork(srv.url, 'kinds-retail', KIND_MVP, window);
      assert.equal(work.status, 200, window);
      assert.ok(work.data.pages, window);
    }
  } finally {
    await close();
  }
});

for (const id of ['nyctaxi', 'tpcds-retail']) {
  test(`${id}: a demo MVP without a recorded My work route hides My work and never answers it with a 404 page`, async () => {
    const mvp = firstMvp(id);
    const { srv, close } = await serve([demoBundle(id, without(ALL[id].mvps[mvp].api, 'POST /api/my_work'))]);
    try {
      const shell = (await app(srv.url, id, mvp)).data;
      assert.equal(shell.screens.performance, false);
      const work = await myWork(srv.url, id, mvp);
      assert.equal(work.status, 404);
      assert.equal(work.data.error, NOT_PART);
      assert.equal(work.data.showcase, true);
    } finally {
      await close();
    }
  });
}

test('a demo MVP without recorded Impact, Runs, Feedback or Alerts hides those sections', async () => {
  const api = without(without(without(without(ALL['kinds-retail'].mvps[KIND_MVP].api, 'GET /api/impact'), 'GET /api/runs'), 'GET /api/feedback'), 'GET /api/alerts');
  const bundle = demoBundle('kinds-retail', { ...api, 'GET /api/app': { status: 200, body: { ...api['GET /api/app'].body, alerting: { on: true } } } }, KIND_MVP);
  const { srv, close } = await serve([bundle]);
  try {
    const shell = (await app(srv.url, 'kinds-retail', KIND_MVP)).data;
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
  const body = ALL['kinds-retail'].mvps[KIND_MVP].api['GET /api/app'].body;
  assert.deepEqual(S.gatedApp(body, ALL['kinds-retail'].mvps[KIND_MVP].api), body);
});

for (const id of ['nyctaxi', 'tpcds-retail']) {
  test(`${id}: its MVPs offer My work only when the recording has it, and every My work screen they offer answers from the recording`, async () => {
    const { srv, close } = await serve([ALL[id]]);
    try {
      assert.ok(Object.keys(ALL[id].mvps).length > 0, `${id} carries an MVP App`);
      for (const [mvp, { api }] of Object.entries(ALL[id].mvps)) {
        const recorded = routesOf(api).has('POST /api/my_work');
        const shell = (await app(srv.url, id, mvp)).data;
        assert.equal(shell.screens.performance, recorded, `${id}/${mvp} offers My work exactly when it is recorded`);
        if (!recorded) continue;
        for (const window of ['today', 'week', 'month', 'all']) {
          const work = await myWork(srv.url, id, mvp, window);
          assert.equal(work.status, 200, `${id}/${mvp} ${window}: ${JSON.stringify(work.data).slice(0, 120)}`);
          assert.ok(work.data.pages, `${id}/${mvp} ${window}`);
        }
      }
    } finally {
      await close();
    }
  });
}
