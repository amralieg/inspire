// REQ-527 / REQ-506 (RC6-A-04): the value chip asks GET value/counter on every shell page; the demo has no live counter, so it answers
// "not shown" itself and never a 404 (a 404 logs one console error per MVP page).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../lib/appShell');

test('every MVP of every demo answers the value chip routes 200 with the counter not shown, and no 4xx', async () => {
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { shellFiles: appShellFiles(appShellPayload(bundledAppShellText())), log: { error: (m) => { throw new Error(m); } } });
  const srv = await listen(app);
  let checked = 0;
  const failed = [];
  try {
    for (const [id, bundle] of Object.entries(S.loadShowcases())) {
      for (const mvp of Object.keys(bundle.mvps)) {
        for (const route of ['value/counter', 'value/leaders']) {
          const r = await fetch(`${srv.url}/showcase/${id}/mvp/${mvp}/api/${route}?page=p`);
          const body = await r.json().catch(() => null);
          checked += 1;
          if (r.status !== 200 || !body || body.shown !== false) failed.push(`${id}/${mvp} ${route} -> ${r.status} ${JSON.stringify(body)}`);
        }
      }
    }
  } finally { await srv.close(); }
  assert.ok(checked >= 34, `checked ${checked}`);
  assert.deepEqual(failed.slice(0, 10), [], `${failed.length} of ${checked} failed`);
});
