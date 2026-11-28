// c39 (REQ-585 items 8 and 9) acceptance, written by the c39 spec writer; the builder may not edit or weaken this file.
// 9: labelBeforeLaunch reports progress { done, total } through options.onProgress; at the labelling deadline it stops waiting, writes what
//    is labelled and launches; the tables it did not label get no row (the agent classifies them). The server keeps the progress per
//    session in memory (lib/labelProgress.js) and GET /api/inspire/labels/progress answers it to the person who launched.
// 8: "Find suitable data for me" (plan/sort) leaves out tables of dev-looking schemas by name (reason "dev"), keeps every catalog the
//    person ticked, and never comes back empty: a demo-looking catalog still yields tables. One dev-name helper, frontend/src/lib/devNames.js.
// Runs with no node_modules: fake app objects stand in for express. Neutral fixture names only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TL = require('../lib/appTableLabels');

const BACKEND = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');
const PARAMS = { '01_uc_metadata': 'main', '02_inspire_database': 'main.inspire', '04_table_election': 'Let Inspire Decides', '14_session_id': '7100' };
const ME = 'launcher@example.com';

// ---- 9: progress and leftovers ----------------------------------------------------------------------------------------------------

const tablesIn = (schema, n) => Array.from({ length: n }, (_, i) => ({ fqn: `main.${schema}.t${String(i + 1).padStart(3, '0')}`, comment: '', columns: [{ name: 'id', type: 'bigint' }] }));
const FAST = tablesIn('fast', 300);
const SLOW = tablesIn('slow', 300);
// A table prompt whose first table is in main.slow never answers; every other prompt answers at once.
function callModel({ prompt }) {
  if (/Classify each database (catalog|schema)/.test(prompt)) {
    const n = (prompt.match(/^\d+\. /gm) || []).length;
    return Promise.resolve(Array.from({ length: n }, (_, i) => `${i + 1}|p`).join('\n'));
  }
  const lines = prompt.match(/^\d+\. main\.\w+\.\w+/gm) || [];
  if (lines.length && /^\d+\. main\.slow\./.test(lines[0])) return new Promise(() => {});
  return Promise.resolve(lines.map((_l, i) => `${i + 1}|p|t`).join('\n'));
}
function deps(written) {
  return {
    log: () => {},
    modelNames: async () => ['system.ai.claude-haiku-4-5'],
    callModel,
    run: async (sql, parameters) => { written.push({ sql, parameters: parameters || [] }); },
    listScope: async () => ({
      userNamed: { catalogs: ['main'], schemas: [] },
      catalogs: [{ name: 'main', comment: '' }],
      schemasOf: async () => [{ name: 'fast', comment: '' }, { name: 'slow', comment: '' }],
      tablesOf: async (_cat, sch) => (sch === 'fast' ? FAST : SLOW),
    }),
  };
}
const tableFqnsWritten = (written) => written.filter((w) => /^INSERT INTO/.test(w.sql))
  .flatMap((w) => w.parameters.filter((p) => /^f\d+$/.test(p.name)).map((p) => p.value))
  .filter((fqn) => fqn.split('.').length === 3);

test('REQ-585 9: labelBeforeLaunch reports { done, total } through onProgress, from 0 of N up to what it labelled (must-fail on the base)', async () => {
  const seen = [];
  const written = [];
  await TL.labelBeforeLaunch(PARAMS, deps(written), { budgetMs: 6500, onProgress: (p) => seen.push({ done: p.done, total: p.total }) });
  assert.ok(seen.length >= 2, `onProgress was called ${seen.length} times`);
  assert.deepEqual(seen[0], { done: 0, total: 600 }, 'the first report is 0 of every table sent to the classifier');
  for (let i = 1; i < seen.length; i += 1) {
    assert.equal(seen[i].total, 600, 'the total does not change');
    assert.ok(seen[i].done >= seen[i - 1].done, 'done never goes down');
  }
  const last = seen[seen.length - 1];
  assert.ok(last.done > 0 && last.done < last.total, `the slow tables stay unlabelled: ${JSON.stringify(last)}`);
  assert.equal(last.done, new Set(tableFqnsWritten(written)).size, 'the last done count is the number of table rows written');
});

test('REQ-585 9: at the deadline the labelled tables are written and the launch goes on; the leftover tables get no row (must-fail on the base)', async () => {
  const written = [];
  const started = Date.now();
  const out = await TL.labelBeforeLaunch(PARAMS, deps(written), { budgetMs: 6500, onProgress: () => {} });
  const took = Date.now() - started;
  assert.ok(took < 6000, `labelling stops waiting at the labelling deadline, before the hard budget (took ${took} ms)`);
  assert.ok(!out.skipped, `the partial labels are kept, not skipped: ${JSON.stringify(out)}`);
  const fqns = tableFqnsWritten(written);
  assert.ok(fqns.length > 0, 'the labelled tables were written');
  assert.ok(fqns.every((f) => f.startsWith('main.fast.')), 'only tables the model answered are written');
  assert.ok(!fqns.some((f) => f.startsWith('main.slow.')), 'a leftover table gets no row, so the agent classifies it');
  assert.ok(written.some((w) => /CREATE TABLE IF NOT EXISTS main\.inspire\.__inspire_table_labels/.test(w.sql)));
});

test('REQ-585 9: another election mode never reports progress (must-exclude)', async () => {
  const seen = [];
  await TL.labelBeforeLaunch({ ...PARAMS, '04_table_election': 'All Tables' }, deps([]), { budgetMs: 6500, onProgress: (p) => seen.push(p) });
  assert.deepEqual(seen, []);
});

// ---- 9: the progress store and route ------------------------------------------------------------------------------------------------

function fakeApp() {
  const routes = {};
  const add = (method) => (p, ...handlers) => { routes[`${method} ${p}`] = handlers; };
  return { routes, get: add('GET'), post: add('POST') };
}
async function call(handlers, { query = {}, person = ME } = {}) {
  const req = { query, body: {}, headers: person ? { 'x-forwarded-email': person } : {} };
  const res = { code: 200, body: undefined, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handlers[handlers.length - 1](req, res);
  return res;
}

test('REQ-585 9: GET /api/inspire/labels/progress answers n of N to the launcher, nothing to anyone else (must-fail on the base)', async () => {
  const LP = require('../lib/labelProgress');
  const requireToken = (_req, _res, next) => next();
  const progress = LP.createLabelProgress();
  const app = fakeApp();
  LP.registerLabelProgressRoute(app, { requireToken, progress });
  const route = app.routes['GET /api/inspire/labels/progress'];
  assert.ok(route, 'the route is registered');
  assert.equal(route[0], requireToken, 'the route signs in like its neighbours');

  progress.begin('7100', ME);
  progress.update('7100', { done: 3, total: 7 });
  const mine = await call(route, { query: { session_id: '7100' } });
  assert.equal(mine.code, 200);
  assert.deepEqual({ done: mine.body.done, total: mine.body.total, state: mine.body.state }, { done: 3, total: 7, state: 'labelling' });

  const other = await call(route, { query: { session_id: '7100' }, person: 'someone@example.com' });
  assert.deepEqual({ done: other.body.done, total: other.body.total, state: other.body.state }, { done: 0, total: 0, state: 'none' });
  const unknown = await call(route, { query: { session_id: '999' } });
  assert.deepEqual({ done: unknown.body.done, total: unknown.body.total, state: unknown.body.state }, { done: 0, total: 0, state: 'none' });

  progress.finish('7100');
  const done = await call(route, { query: { session_id: '7100' } });
  assert.deepEqual({ done: done.body.done, total: done.body.total, state: done.body.state }, { done: 3, total: 7, state: 'done' });

  const bad = await call(route, { query: {} });
  assert.equal(bad.code, 400, 'no session_id is a 400');
});

test('REQ-585 9: the route has a route policy and an OpenAPI entry, and the launch feeds the progress (must-fail on the base)', () => {
  const RP = require('../lib/routePolicy');
  assert.ok(Object.hasOwn(RP.ROUTE_POLICY, 'GET /api/inspire/labels/progress'), 'routePolicy entry');
  assert.match(read('openapi.yaml'), /^ {2}\/api\/inspire\/labels\/progress:\n {4}get:/m, 'openapi entry');
  const server = read('server.js');
  assert.match(server, /registerLabelProgressRoute\(app,/, 'server.js registers the progress route');
  assert.match(server, /onProgress/, 'labelTablesBeforeLaunch passes onProgress to labelBeforeLaunch');
});

// ---- 8: dev exclusion only in Find suitable data for me ----------------------------------------------------------------------------

const PERSON = 'planner@example.com';
const meta = (tables) => (sql) => {
  const split = tables.map((t) => t.split('.'));
  if (/information_schema\.columns/i.test(sql)) return split.map(([c, s, n]) => ({ table_catalog: c, table_schema: s, table_name: n, column_name: 'id', data_type: 'bigint', comment: 'Row id' }));
  if (/information_schema\.tables/i.test(sql)) return split.map(([c, s, n]) => ({ table_catalog: c, table_schema: s, table_name: n, table_type: 'MANAGED', comment: `Table ${n}` }));
  return [];
};
// The model places every table it sees in one run; the route, not the model, applies the dev rule.
async function sortPlan(catalogs, tables) {
  const { registerWizPlanRoutes } = require('../lib/wizPlanRoutes');
  const app = fakeApp();
  const answer = meta(tables);
  registerWizPlanRoutes(app, {
    requireToken: (_q, _s, n) => n(),
    executeSql: async (_h, _t, _w, sql) => answer(sql),
    sqlResultToObjects: (rows) => rows,
    chatModel: async (_req, messages) => {
      const seen = tables.filter((t) => messages.some((m) => String(m.content).includes(t)));
      return { got: { ok: true, data: { choices: [{ message: { content: JSON.stringify({ runs: [{ name: 'Core', why: 'They join', tables: seen.map((table) => ({ table, why: 'core' })) }], left_out: [] }) } }] } } };
    },
    launchRun: async () => ({ status: 500, body: {} }),
    readRun: async () => ({ ok: false }),
    now: () => new Date('2026-11-28T10:00:00Z'),
  });
  const res = await call(app.routes['POST /api/inspire/plan/sort'].map((h) => (req, r) => h({ ...req, body: { warehouse_id: 'wh1', catalogs, business_name: 'Example Co' }, dbHost: 'h', dbToken: 't' }, r)),
    { person: PERSON });
  return res;
}
const placedOf = (plan) => plan.runs.flatMap((r) => r.tables.map((t) => t.table)).sort();

test('REQ-585 8: Find suitable data leaves out the tables of dev-looking schemas, reason "dev" (must-fail on the base)', async () => {
  const prod = ['main.sales.orders', 'main.sales.items', 'main.sales.stores'];
  const dev = ['main.sales_dev.orders', 'main.sales_dev.items', 'main.scratch.notes'];
  const res = await sortPlan(['main'], [...prod, ...dev]);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(placedOf(res.body), [...prod].sort(), 'no table of a dev-looking schema is placed in a run');
  const group = (res.body.left_out || []).find((g) => g.reason === 'dev');
  assert.ok(group, `a left-out group with reason "dev": ${JSON.stringify(res.body.left_out)}`);
  assert.deepEqual([...group.tables].sort(), [...dev].sort());
  assert.equal(group.count, 3);
  assert.match(group.label, /dev/i);
});

test('REQ-583 / REQ-585 8: a ticked catalog that looks dev by name (a demo catalog) is kept and still yields tables (must-fail-safe)', async () => {
  const tables = ['demo_retail.sales.orders', 'demo_retail.sales.items', 'demo_retail.stock.levels'];
  const res = await sortPlan(['demo_retail'], tables);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(placedOf(res.body), [...tables].sort(), 'the catalog the person ticked is never dropped for its name');
  assert.ok(!(res.body.left_out || []).some((g) => g.reason === 'dev'));
});

test('REQ-583 / REQ-585 8: when every schema looks dev the plan keeps them rather than come back empty (must-fail-safe)', async () => {
  const tables = ['sandbox_co.dev.orders', 'sandbox_co.dev.items', 'sandbox_co.test_area.notes'];
  const res = await sortPlan(['sandbox_co'], tables);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(placedOf(res.body), [...tables].sort(), 'dev exclusion never empties a plan');
});

test('REQ-585 8: plan/sort uses the one dev-name helper, frontend/src/lib/devNames.js (no second implementation) (must-fail on the base)', () => {
  assert.match(read('lib/wizPlanRoutes.js'), /require\(['"]\.\.\/\.\.\/frontend\/src\/lib\/devNames(\.js)?['"]\)/);
});
