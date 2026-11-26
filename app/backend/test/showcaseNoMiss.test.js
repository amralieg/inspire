// REQ-527 / REQ-506 (RC6-A-04, rest of the class): every request the shell sends while a demo MVP page loads or is used gets a 2xx.
// The bodies are the ones web/src/api.js builds: Layouts.jsx TodoNow sends the list with windowParams(DEFAULT_PREFS) and the open-status
// column filter (records.js OPEN_STATUSES), a body the demos were recorded without.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../lib/appShell');

const OPEN = ['New', 'In progress'];
const todoBody = (page, filters = {}) => ({ window: 'all', time_zone: 'Asia/Dubai', column_filters: { action_status: OPEN }, page, filters, offset: 0, limit: 5 });
const decides = (p) => !!p.records && p.layout?.decides !== false;

async function serve() {
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { shellFiles: appShellFiles(appShellPayload(bundledAppShellText())), log: { error: (m) => { throw new Error(m); } } });
  return listen(app);
}

test('every MVP of every demo answers the shell load and click reads with no 4xx or 5xx', async () => {
  const srv = await serve();
  let checked = 0;
  const failed = [];
  try {
    for (const [id, bundle] of Object.entries(S.loadShowcases())) {
      for (const [mvp, rec] of Object.entries(bundle.mvps)) {
        const base = `${srv.url}/showcase/${id}/mvp/${mvp}/api`;
        for (const page of rec.api['GET /api/app'].body.pages) {
          const calls = [
            ['GET', 'value/counter?page=' + page.id], ['GET', 'value/leaders?page=' + page.id],
            ['GET', 'records/batches?page=' + page.id], ['GET', `records/population?page=${page.id}&record_key=K1`],
            ['GET', `records/similar?page=${page.id}&by=region&record_key=K1`], ['GET', 'agent/briefing?page=' + page.id],
            ...(decides(page) ? [['POST', 'records', todoBody(page.id)]] : []),
          ];
          for (const [method, route, body] of calls) {
            const r = await fetch(`${base}/${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
            checked += 1;
            if (r.status >= 400) failed.push(`${id}/${mvp} ${method} ${route} -> ${r.status}`);
            else if (route === 'records') {
              const data = await r.json();
              if (!Array.isArray(data.rows)) failed.push(`${id}/${mvp} ${route} has no rows`);
            }
          }
        }
      }
    }
  } finally { await srv.close(); }
  assert.ok(checked >= 34 * 3, `checked ${checked}`);
  assert.deepEqual(failed.slice(0, 10), [], `${failed.length} of ${checked} failed`);
});

test('a list the demo never recorded for that page and filters, and an unknown route, are still the demo miss 404', async () => {
  const srv = await serve();
  try {
    const [id, bundle] = Object.entries(S.loadShowcases())[0];
    const mvp = Object.keys(bundle.mvps)[0];
    const page = bundle.mvps[mvp].api['GET /api/app'].body.pages[0].id;
    const base = `${srv.url}/showcase/${id}/mvp/${mvp}/api`;
    const post = (route, body) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('records', todoBody(page, { region: ['Nowhere'] }))).status, 404);
    assert.equal((await post('records', todoBody('no_such_page'))).status, 404);
    const unknown = await fetch(`${base}/no/such/route`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, S.SHOWCASE_MISSING);
  } finally { await srv.close(); }
});
