// REQ-431 (F-085, F-093): no GET route of any recorded demo answers 4xx, so no demo page logs a console error.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../lib/appShell');

async function serve() {
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { shellFiles: appShellFiles(appShellPayload(bundledAppShellText())), log: { error: (m) => { throw new Error(m); } } });
  return listen(app);
}

test('every recorded GET route that was a 4xx answers 2xx in every MVP of every demo', async () => {
  const showcases = S.loadShowcases();
  const srv = await serve();
  const failed = [];
  let checked = 0;
  try {
    for (const [id, bundle] of Object.entries(showcases)) {
      for (const [mvp, { api }] of Object.entries(bundle.mvps)) {
        for (const [key, answer] of Object.entries(api)) {
          if (!key.startsWith('GET ') || answer.status < 400) continue;
          checked += 1;
          const r = await fetch(`${srv.url}/showcase/${id}/mvp/${mvp}/api/${key.slice('GET /api/'.length)}`);
          const body = await r.json().catch(() => ({}));
          if (r.status < 200 || r.status >= 300) failed.push(`${id}/${mvp} ${key} -> ${r.status}`);
          else assert.ok(body && typeof body === 'object', `${key} is not a JSON object`);
        }
      }
    }
  } finally { await srv.close(); }
  assert.ok(checked > 0, 'the bundles hold recorded 4xx GET answers');
  assert.deepEqual(failed.slice(0, 20), [], `${failed.length} of ${checked} recorded 4xx GET routes still fail`);
});

test('the built-in answers have the live empty-state shape the pages render', async () => {
  const srv = await serve();
  const mvp = Object.keys(S.loadShowcases()['kinds-retail'].mvps)[0];
  const page = mvp.toLowerCase().replace(/-/g, '_');
  const get = async (rest) => (await (await fetch(`${srv.url}/showcase/kinds-retail/mvp/${mvp}/api/${rest}`)).json());
  try {
    assert.deepEqual((await get(`feedback?page=${page}`)).items, []);
    assert.equal((await get(`feedback?page=${page}`)).missing, false);
    const hist = await get(`records/history?page=${page}&record_key=K1`);
    assert.deepEqual([hist.versions, hist.current, hist.fields], [[], null, []]);
    assert.equal((await get(`trends?page=${page}`)).actions, false);
    const rev = await get(`forecast/review?page=${page}`);
    assert.deepEqual([rev.series, rev.cycle, rev.at_risk], [[], null, 0]);
    assert.ok(rev.missing, 'the review page explains why it is empty');
    const acc = await get(`forecast/accuracy?page=${page}`);
    assert.deepEqual([acc.points, acc.error, acc.lift], [0, null, null]);
    const sc = await get(`scenario/saved?page=${page}`);
    assert.deepEqual([sc.scenarios, sc.decisions], [[], []]);
  } finally { await srv.close(); }
});
