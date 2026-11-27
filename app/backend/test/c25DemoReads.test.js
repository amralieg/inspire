// C25 (REQ-560): a demo recording must hold the value reads, the output folder listing, an exported document and an MVP App,
// and the recorder names every one it lacks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const S = require('../lib/showcase');
const { LISTS, split } = require('./support/showcaseRoutes');

const lists = () => import(pathToFileURL(LISTS).href);
const VALUE = ['GET /api/inspire/value/totals', 'GET /api/inspire/value/yearly', 'GET /api/inspire/value/estimates'];
const FOLDER = 'GET /api/workspace/list';
const EXPORT = 'GET /api/workspace/export';
const ok = (body = {}) => ({ status: 200, body });

const exchangeOf = (route, url = '') => {
  const [method, p] = split(route);
  return { method, url: `https://inspire.example${p}${url || '?session_id=1'}`, status: 200 };
};

const FULL = {
  version: 1, id: 'taxi', title: 'Taxi', business: 'Taxi', session_id: '1001',
  build: 'v1.6.1', recorded_at: '2026-11-28T09:00:00Z',
  inspire: {
    'GET /api/inspire/value/totals?session_id=1001': ok({ use_cases: { 'N01-U01': { value_year: 1200 } } }),
    'GET /api/inspire/value/yearly?session_id=1001': ok({ use_cases: {} }),
    'GET /api/inspire/value/estimates?session_id=1001': ok({ use_cases: {} }),
    'GET /api/workspace/list?path=%2FWorkspace%2Fdemo': ok({ files: [{ name: 'strategy.pdf', path: '/Workspace/demo/strategy.pdf' }] }),
    'GET /api/workspace/export?path=%2FWorkspace%2Fdemo%2Fstrategy.pdf': { status: 200, body: Buffer.from('%PDF-1.4 demo').toString('base64'), base64: true, type: 'application/pdf' },
  },
  mvps: { 'N01-U01': { title: 'Fare desk', api: { 'GET /api/app': ok({ title: 'Fare desk', pages: [] }), 'POST /api/overview': ok({ cards: [] }) } } },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the walk list names the value reads, the output folder listing and the export of a document', async () => {
  const { DEMO_READS, DEMO_READS_WHEN, NOT_IN_DEMO } = await lists();
  for (const route of [...VALUE, FOLDER, EXPORT]) {
    assert.ok(route in DEMO_READS, `${route} is a read the demo walk must record`);
    assert.ok(!(route in NOT_IN_DEMO), `${route} is no longer excused as not in the demo`);
    assert.ok(!(route in DEMO_READS_WHEN), `${route} is on one list only`);
  }
});

test('unrecorded() flags a recording with no value reads, no folder listing and no export, and a full one passes', async () => {
  const { DEMO_READS, unrecorded } = await lists();
  const all = Object.keys(DEMO_READS).map((route) => exchangeOf(route));
  assert.deepEqual(unrecorded(all), []);
  const without = (routes) => all.filter((x) => !routes.some((r) => r === `${x.method} ${new URL(x.url).pathname}`));
  assert.deepEqual(unrecorded(without(VALUE)), VALUE);
  assert.deepEqual(unrecorded(without([FOLDER])), [FOLDER]);
  assert.deepEqual(unrecorded(without([EXPORT])), [EXPORT]);
});

test('showcaseStale() accepts a recording with values, documents, an MVP App and a build stamp', () => {
  assert.equal(typeof S.showcaseStale, 'function');
  assert.deepEqual(S.showcaseStale(clone(FULL)), []);
});

test('showcaseStale() names each missing part: values, folder listing, document, MVP App, build stamp', () => {
  const drop = (pred) => { const b = clone(FULL); for (const k of Object.keys(b.inspire)) if (pred(k)) delete b.inspire[k]; return b; };
  assert.deepEqual(S.showcaseStale(drop((k) => k.includes('/value/'))), ['no value reads']);
  assert.deepEqual(S.showcaseStale(drop((k) => k.includes('/workspace/list'))), ['no listing of the output folder']);
  assert.deepEqual(S.showcaseStale(drop((k) => k.includes('/workspace/export'))), ['no export of a generated document']);
  const notebook = clone(FULL);
  notebook.inspire['GET /api/workspace/export?path=%2FWorkspace%2Fdemo%2Fa.ipynb'] = notebook.inspire[Object.keys(notebook.inspire).find((k) => k.includes('/export'))];
  delete notebook.inspire['GET /api/workspace/export?path=%2FWorkspace%2Fdemo%2Fstrategy.pdf'];
  assert.deepEqual(S.showcaseStale(notebook), ['no export of a generated document'], 'a notebook is not a generated document');
  const bare = clone(FULL); bare.mvps = {};
  assert.deepEqual(S.showcaseStale(bare), ['no MVP App']);
  const hollow = clone(FULL); hollow.mvps['N01-U01'].api = { 'GET /api/app': ok({ title: 'x' }) };
  assert.deepEqual(S.showcaseStale(hollow), ['no MVP App'], 'an App page with no data read is not an App');
  const old = clone(FULL); delete old.build;
  assert.deepEqual(S.showcaseStale(old), ['no build stamp']);
  const none = clone(FULL); none.inspire = {}; none.mvps = {}; delete none.build;
  assert.equal(S.showcaseStale(none).length, 5);
});

test('an older recording without the new fields still loads (the shape did not change)', () => {
  const old = clone(FULL); delete old.build; delete old.recorded_at;
  assert.equal(S.showcaseProblem(old, 'taxi.json'), '');
  assert.equal(S.SHOWCASE_VERSION, 1);
});
