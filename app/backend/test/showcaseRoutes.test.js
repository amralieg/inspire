const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');
const { LISTS, WORKSPACE_API, apiPathAt, backendRoutes, frontendPaths, matches, mvpRoutes, prefixCheckAt, routeGaps, split } = require('./support/showcaseRoutes');

const lists = () => import(pathToFileURL(LISTS).href);

const BUNDLE = {
  version: 1, id: 'taxi', title: 'NYC Taxi Operations', business: 'NYC Taxi Operations', session_id: '1001',
  inspire: { 'GET /api/inspire/sessions': { status: 200, body: { sessions: [] } } },
  mvps: { 'N01-U01': { title: 'Fare desk', api: { 'GET /api/app': { status: 200, body: { title: 'Fare desk' } } } } },
};

async function demoServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-routes-'));
  fs.writeFileSync(path.join(dir, 'taxi.json'), JSON.stringify(BUNDLE));
  const reached = [];
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { dir, shellFiles: { 'static/index.html': '<html>' }, log: { error: () => {} } });
  app.all('/api/*rest', (req, res) => {
    reached.push(`${req.method} ${req.path}`);
    res.status(500).json({ error: 'the workspace answered', stack: 'Error: boom\n    at handler (server.js:1:1)' });
  });
  const srv = await listen(app);
  return { srv, reached, close: async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

async function send(base, method, url) {
  const resp = await fetch(base + url, {
    method,
    headers: { [S.SHOWCASE_HEADER]: 'taxi', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) },
    body: method === 'GET' ? undefined : JSON.stringify({ session_id: '1001', use_case_id: 'N01-U01' }),
  });
  const text = await resp.text();
  return { status: resp.status, type: resp.headers.get('content-type') || '', text };
}

const concrete = (pattern) => pattern.replace(/:p/g, 'x');

test('the inventory reads the real routes: frontend calls, backend routes and the MVP App calls', () => {
  const frontend = frontendPaths();
  for (const p of ['/api/inspire/portfolio', '/api/inspire/implement/settings/preview', '/api/catalogs/:p/schemas', '/api/tables/:p/:p', '/api/run/:p/cancel',
    '/api/inspire/session', '/api/defaults', '/api/app']) {
    assert.ok(frontend.has(p), `the frontend inventory has ${p}: ${[...frontend.keys()].sort().join(' ')}`);
  }
  assert.ok(![...frontend.keys()].some((p) => WORKSPACE_API.test(p) || p.includes('?') || p.includes('$')), 'no workspace REST path, query or template text');
  assert.ok(frontend.size >= 50, `the frontend calls ${frontend.size} paths`);
  const backend = backendRoutes();
  for (const r of ['POST /api/inspire/implement/settings/save', 'DELETE /api/inspire/session', 'GET /api/catalogs/:p/schemas', 'GET /api/showcase', 'POST /api/run/:p/cancel']) {
    assert.ok(backend.has(r), `the backend inventory has ${r}`);
  }
  const mvp = mvpRoutes();
  for (const r of ['GET /api/app', 'POST /api/page', 'POST /api/records/act', 'POST /api/records/:p', 'POST /api/alerts/save', 'GET /api/genie/message']) {
    assert.ok(mvp.has(r), `the MVP App inventory has ${r}: ${[...mvp].sort().join(' ')}`);
  }
});

test('every route a page can call is recorded by the demo walk, refused by the demo, or explained on the not-in-demo list', async () => {
  const { DEMO_READS, DEMO_READS_WHEN, NOT_IN_DEMO } = await lists();
  const gaps = routeGaps({
    backend: backendRoutes(), frontend: frontendPaths(), mvp: mvpRoutes(),
    reads: DEMO_READS, readsWhen: DEMO_READS_WHEN, notInDemo: NOT_IN_DEMO, canRead: S.showcaseCanRead,
  });
  assert.deepEqual(gaps, []);
});

test('the guard finds an unrecorded read, a stale or doubled entry, a write listed as a read, a call nothing serves, and a missing reason', () => {
  const gaps = routeGaps({
    backend: new Set(['GET /api/inspire/portfolio', 'GET /api/inspire/steps', 'POST /api/inspire/feedback', 'GET /api/run/:p', 'GET /api/run/pages']),
    frontend: new Map([['/api/inspire/portfolio', new Set(['a.jsx'])], ['/api/inspire/steps', new Set(['b.jsx'])], ['/api/inspire/feedback', new Set(['c.jsx'])],
      ['/api/run/:p', new Set(['d.jsx'])], ['/api/inspire/gone', new Set(['e.jsx'])], ['/api/page', new Set(['f.mjs'])]]),
    mvp: new Set(['POST /api/page']),
    reads: { 'GET /api/inspire/portfolio': 'Review shows the totals', 'POST /api/inspire/feedback': 'Review sends the feedback here' },
    readsWhen: { 'GET /api/inspire/portfolio': 'Start shows the cards again' },
    notInDemo: { 'GET /api/run/:p': 'no', 'GET /api/inspire/old': 'an old route nobody calls any more' },
    canRead: S.showcaseCanRead,
  });
  assert.deepEqual(gaps, [
    '/api/inspire/gone is called from e.jsx, but no route of the App or of an MVP App serves it',
    'POST /api/inspire/feedback is on the walk list, but it is a change the demo refuses',
    'GET /api/inspire/portfolio is on two lists: walk and walk when the run has it',
    'GET /api/run/:p on the not in the demo list gives no reason',
    'GET /api/inspire/old is on the not in the demo list, but no page of the App calls it',
    'GET /api/inspire/steps is a read a page can send, but the demo walk never records it and the not-in-demo list does not explain why',
  ]);
  assert.equal(matches('/api/run/:p', '/api/run/pages'), false, 'a template segment of the frontend never matches a fixed segment of the backend');
  assert.equal(matches('/api/inspire/implement/settings/preview', '/api/inspire/implement/settings/:p'), true);
});

test('the recorder names every walk route a recording lacks, and an error answer does not count as recorded', async () => {
  const { DEMO_READS, routeOf, unrecorded } = await lists();
  const all = Object.keys(DEMO_READS).map((route) => {
    const [method, p] = split(route);
    return { method, url: `https://inspire.example${p}?session_id=1`, status: 200 };
  });
  assert.deepEqual(unrecorded(all), []);
  const lacking = all.filter((x) => routeOf(x.method, x.url) !== 'GET /api/inspire/steps')
    .map((x) => (routeOf(x.method, x.url) === 'GET /api/inspire/session' ? { ...x, status: 404 } : x));
  assert.deepEqual(unrecorded(lacking), ['GET /api/inspire/session', 'GET /api/inspire/steps']);
  assert.equal(routeOf('get', '/api/inspire/steps?since=2026-10-31T09%3A40%3A00Z'), 'GET /api/inspire/steps');
});

test('a results-only demo needs every walk read but the MVP reads, a demo with MVPs needs them too, and each MVP read is a read the run has when it has an MVP', async () => {
  const { DEMO_MVP_READS, DEMO_READS, DEMO_READS_WHEN, demoReads, unrecorded } = await lists();
  const mvpReads = Object.keys(DEMO_MVP_READS);
  assert.deepEqual(mvpReads, ['GET /api/inspire/implement/status', 'GET /api/inspire/implement/live', 'GET /api/inspire/implement/money',
    'GET /api/inspire/implement/settings', 'GET /api/inspire/implement/tables', 'GET /api/inspire/implement/alerts']);
  assert.deepEqual(mvpReads.filter((r) => r in DEMO_READS), []);
  assert.deepEqual(mvpReads.filter((r) => !(r in DEMO_READS_WHEN)), []);
  assert.deepEqual(demoReads(false), DEMO_READS);
  assert.deepEqual(Object.keys(demoReads(true)), [...Object.keys(DEMO_READS), ...mvpReads]);
  const resultsOnly = Object.keys(DEMO_READS).map((route) => {
    const [method, p] = split(route);
    return { method, url: `https://inspire.example${p}?session_id=1`, status: 200 };
  });
  assert.deepEqual(unrecorded(resultsOnly, demoReads(false)), []);
  assert.deepEqual(unrecorded(resultsOnly, demoReads(true)), mvpReads, 'a demo that names MVPs and recorded none of their reads is refused');
});

test('the inventory parses template paths, stops at the query, and skips workspace REST paths and bare prefixes', () => {
  const text = [
    "fetch(`/api/tables/${encodeURIComponent(a)}/${encodeURIComponent(b || '')}${q(w)}`)",
    "x(`/api/inspire/implement/alerts${step ? `/${step}` : ''}?${qBase}`)",
    "y(`/api/run/${runId}/cancel`, { method: 'POST' })",
    "z(`${host}/api/2.0/sql/warehouses`)",
    "w('/api/defaults returned 500.')",
    "v.startsWith('/api/')",
  ].join('\n');
  const paths = [];
  for (let at = text.indexOf('/api/'); at >= 0; at = text.indexOf('/api/', at + 1)) paths.push(apiPathAt(text, at));
  assert.deepEqual(paths, ['/api/tables/:p/:p', '/api/inspire/implement/alerts', '/api/run/:p/cancel', '/api/2.0/sql/warehouses', '/api/defaults', '/api']);
  assert.equal(WORKSPACE_API.test('/api/2.0/sql/warehouses'), true);
  const guard = "if (pathname.startsWith('/api/genie/')) return refuse(route);\nfetch('/api/genie/ask');";
  assert.equal(prefixCheckAt(guard, guard.indexOf('/api/genie/')), true, 'a startsWith prefix test is not a call');
  assert.equal(prefixCheckAt(guard, guard.lastIndexOf('/api/genie/')), false, 'a fetch of the same prefix is still a call');
});

test('every change a page or an MVP App can send gets the plain read-only answer in the demo, and never reaches the workspace', async () => {
  const writes = [...backendRoutes(), ...mvpRoutes()].filter((route) => !S.showcaseCanRead(...split(route)));
  const mvpWrites = new Set([...mvpRoutes()].filter((route) => !S.showcaseCanRead(...split(route))));
  assert.ok(writes.length >= 25, `${writes.length} changes`);
  const { srv, reached, close } = await demoServer();
  try {
    for (const route of [...new Set(writes)].sort()) {
      const [method, pattern] = split(route);
      const url = mvpWrites.has(route) && !backendRoutes().has(route) ? `/showcase/taxi/mvp/N01-U01${concrete(pattern)}` : concrete(pattern);
      const got = await send(srv.url, method, url);
      assert.equal(got.status, 403, `${route}: ${got.text.slice(0, 200)}`);
      assert.match(got.type, /application\/json/, route);
      assert.deepEqual(JSON.parse(got.text), { error: S.SHOWCASE_READ_ONLY, showcase: true }, route);
      assert.doesNotMatch(got.text, /\n\s+at\s|Error:|stack/i, route);
    }
    assert.deepEqual(reached, []);
  } finally {
    await close();
  }
});

test('the demo refuses each named change in plain words: alerts, settings, launch, publish, delete, feedback, Genie and MVP App record actions', async () => {
  const named = {
    'add, change, pause and delete an alert': [['POST', '/api/inspire/implement/alerts/save'], ['POST', '/api/inspire/implement/alerts/pause'],
      ['POST', '/api/inspire/implement/alerts/delete'], ['POST', '/api/inspire/implement/alerts/preview']],
    'change a setting or run with it': [['POST', '/api/inspire/implement/settings/save'], ['POST', '/api/inspire/implement/settings/preview'],
      ['POST', '/api/inspire/implement/settings/run'], ['POST', '/api/inspire/implement/table-change']],
    'launch a run or a build': [['POST', '/api/run'], ['POST', '/api/demo-data/start'], ['POST', '/api/inspire/implement/submit'],
      ['POST', '/api/inspire/implement/rerun'], ['POST', '/api/run/5/cancel']],
    publish: [['POST', '/api/inspire/implement/publish'], ['POST', '/api/publish']],
    delete: [['DELETE', '/api/inspire/session?session_id=1001']],
    'feedback and acknowledgement': [['POST', '/api/inspire/feedback'], ['POST', '/api/inspire/ack']],
    'Genie actions': [['POST', '/api/inspire/generate-genie'], ['POST', '/api/inspire/sync-genie-flags'], ['POST', '/api/inspire/implement/control']],
    'MVP App record, money, settings and alert actions': [['POST', '/showcase/taxi/mvp/N01-U01/api/records/act'], ['POST', '/showcase/taxi/mvp/N01-U01/api/records/update'],
      ['POST', '/showcase/taxi/mvp/N01-U01/api/refresh'], ['POST', '/showcase/taxi/mvp/N01-U01/api/money/assumption'],
      ['POST', '/showcase/taxi/mvp/N01-U01/api/settings/save'], ['POST', '/showcase/taxi/mvp/N01-U01/api/alerts/save']],
  };
  const { srv, reached, close } = await demoServer();
  try {
    for (const [what, calls] of Object.entries(named)) {
      for (const [method, url] of calls) {
        const got = await send(srv.url, method, url);
        assert.equal(got.status, 403, `${what}: ${method} ${url}`);
        assert.deepEqual(JSON.parse(got.text), { error: S.SHOWCASE_READ_ONLY, showcase: true }, `${what}: ${method} ${url}`);
      }
    }
    assert.match(S.SHOWCASE_READ_ONLY, /^This is the demo, so nothing in it changes\./);
    assert.deepEqual(reached, []);
  } finally {
    await close();
  }
});
