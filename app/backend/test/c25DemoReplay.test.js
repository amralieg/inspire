// C25 (REQ-560): the replay serves the value reads, a document's bytes and an MVP App page offline; a document save is refused read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from([0, 1, 2, 250, 251, 252, 255]), Buffer.from('\n%%EOF')]);
const BUNDLE = {
  version: 1, id: 'taxi', title: 'Taxi', business: 'Taxi', session_id: '1001', build: 'v1.6.1',
  inspire: {
    'GET /api/inspire/value/totals?session_id=1001': { status: 200, body: { use_cases: { 'N01-U01': { value_year: 1200 } } } },
    'GET /api/workspace/list?path=%2FWorkspace%2Fdemo': { status: 200, body: { files: [{ name: 'strategy.pdf', path: '/Workspace/demo/strategy.pdf' }] } },
    'GET /api/workspace/export?path=%2FWorkspace%2Fdemo%2Fstrategy.pdf': { status: 200, body: PDF.toString('base64'), base64: true, type: 'application/pdf' },
  },
  mvps: { 'N01-U01': { title: 'Fare desk', api: { 'GET /api/app': { status: 200, body: { title: 'Fare desk' } }, 'POST /api/overview': { status: 200, body: { cards: [1] } } } } },
};

async function serve() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c25-replay-'));
  fs.writeFileSync(path.join(dir, 'taxi.json'), JSON.stringify(BUNDLE));
  const reached = [];
  const app = express();
  app.use(express.json());
  app.use('/api', S.showcaseWriteGuard);
  S.registerShowcaseRoutes(app, { dir, shellFiles: { 'static/index.html': '<html>app</html>' }, log: { error: (m) => { throw new Error(m); } } });
  app.all('/api/*rest', (req, res) => { reached.push(`${req.method} ${req.path}`); res.status(500).json({}); });
  const srv = await listen(app);
  return { srv, reached, close: async () => { await srv.close(); } };
}
const demo = { [S.SHOWCASE_HEADER]: 'taxi' };

test('the demo replays the recorded value totals and the output folder listing', async () => {
  const { srv, close } = await serve();
  try {
    const totals = await fetch(`${srv.url}/api/inspire/value/totals?session_id=1001&inspire_database=real.db&warehouse_id=w1`, { headers: demo });
    assert.equal(totals.status, 200);
    assert.equal((await totals.json()).use_cases['N01-U01'].value_year, 1200);
    const list = await fetch(`${srv.url}/api/workspace/list?path=${encodeURIComponent('/Workspace/demo')}`, { headers: demo });
    assert.equal((await list.json()).files[0].name, 'strategy.pdf');
  } finally { await close(); }
});

test('the demo replays a recorded PDF byte for byte with its content type', async () => {
  const { srv, close } = await serve();
  try {
    const r = await fetch(`${srv.url}/api/workspace/export?path=${encodeURIComponent('/Workspace/demo/strategy.pdf')}`, { headers: demo });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/pdf/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF);
  } finally { await close(); }
});

test('the demo serves an MVP App page and its data read with no live call', async () => {
  const { srv, reached, close } = await serve();
  try {
    const page = await fetch(`${srv.url}/showcase/taxi/mvp/N01-U01/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /app/);
    const app = await fetch(`${srv.url}/showcase/taxi/mvp/N01-U01/api/app`);
    assert.equal((await app.json()).title, 'Fare desk');
    const overview = await fetch(`${srv.url}/showcase/taxi/mvp/N01-U01/api/overview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.deepEqual(await overview.json(), { cards: [1] });
    assert.deepEqual(reached, []);
  } finally { await close(); }
});

test('a demo POST that saves a document is refused with the read-only message and never reaches the workspace', async () => {
  const { srv, reached, close } = await serve();
  try {
    const r = await fetch(`${srv.url}/api/inspire/docs/save`, { method: 'POST', headers: { ...demo, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'a.pdf', content_base64: 'AAAA' }) });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: S.SHOWCASE_READ_ONLY, showcase: true });
    assert.deepEqual(reached, []);
  } finally { await close(); }
});

test('a base64 answer must carry a base64 string body and a content type', () => {
  const bad = JSON.parse(JSON.stringify(BUNDLE));
  bad.inspire['GET /api/workspace/export?path=%2FWorkspace%2Fdemo%2Fstrategy.pdf'] = { status: 200, body: { not: 'a string' }, base64: true };
  assert.match(S.showcaseProblem(bad, 'taxi.json'), /base64/);
  assert.equal(S.showcaseProblem(BUNDLE, 'taxi.json'), '');
});
