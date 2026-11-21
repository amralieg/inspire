// REQ-431 (F-085, F-093): the demo answers the routes the shell always asks, so no page 404s and the plan page loads.
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
const get = async (srv, url) => {
  const r = await fetch(srv.url + url);
  return { status: r.status, data: await r.json() };
};
const MVPS = () => Object.keys(S.loadShowcases()['kinds-retail'].mvps);
const api = (mvp, rest) => `/showcase/kinds-retail/mvp/${mvp}/api/${rest}`;

test('every MVP of the kinds demo answers agent/status, so the walk sees no 404', async () => {
  const srv = await serve();
  try {
    for (const mvp of MVPS()) {
      const got = await get(srv, api(mvp, `agent/status?page=${mvp.toLowerCase().replace('-', '_')}`));
      assert.equal(got.status, 200, `${mvp}: ${JSON.stringify(got.data)}`);
      assert.equal(got.data.mode, 'genie', mvp);
    }
  } finally { await srv.close(); }
});

test('the demo plan page loads: one editable demo draft, no decision buttons that cannot work', async () => {
  const srv = await serve();
  try {
    const got = await get(srv, api('N05-U01', 'plans?page=n05_u01'));
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(!got.data.missing);
    assert.equal(got.data.can_decide, false);
    assert.equal(got.data.versions.length, 1);
    assert.equal(got.data.versions[0].editable, true);
    const perf = await get(srv, api('N05-U01', 'plans/performance?page=n05_u01'));
    assert.equal(perf.status, 200, JSON.stringify(perf.data));
    assert.ok(!perf.data.version && !perf.data.missing);
  } finally { await srv.close(); }
});
