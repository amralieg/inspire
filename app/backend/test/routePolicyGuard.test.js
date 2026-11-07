const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { fileNames } = require('./support/sourceFiles');
const express = require('express');
const P = require('../lib/routePolicy');
const S = require('./support/serverApp');
const { SAMPLES } = require('./support/routeSamples');

const realFetch = globalThis.fetch;
const backend = path.join(__dirname, '..');
const sources = ['server.js', 'implementRoutes.js', ...fileNames(path.join(backend, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`)];
const sourceText = (rel) => fs.readFileSync(path.join(backend, rel), 'utf8');
const scannedRoutes = () => sources.flatMap((rel) => P.changingRoutesInSource(sourceText(rel)).map((r) => ({ ...r, file: rel })));
const everyRoute = () => sources.flatMap((rel) => P.routesInSource(sourceText(rel)).map((r) => ({ ...r, file: rel })));

test.after(() => S.stopServer());

test('every route in the backend source, reads included, has an entry in the policy table', () => {
  const routes = everyRoute();
  assert.ok(routes.some((r) => r.key.startsWith('GET ')) && routes.some((r) => !r.key.startsWith('GET ')), 'the scan sees reads and changes');
  assert.ok(routes.length > 0, 'the scan found no changing route, so it is broken');
  assert.deepEqual(P.missingFromPolicy(routes).map((r) => `${r.file}: ${r.key}`), []);
});

test('the scan fails on a route that is not in the table, static or templated (must-fail)', () => {
  const fake = [
    "app.post('/api/brand-new-action', requireToken, handler);",
    'app.delete(`/api/things/${kind}`, requireToken, handler);',
    'app.post(`/api/inspire/implement/settings/${action}`, requireToken, handler);',
  ].join('\n');
  const missing = P.missingFromPolicy(P.changingRoutesInSource(fake)).map((r) => r.key);
  assert.deepEqual(missing, ['POST /api/brand-new-action', 'DELETE /api/things/${kind}']);
});

test('no route is registered in a way the scan and the registration guard cannot see', () => {
  for (const rel of sources) {
    const text = sourceText(rel);
    assert.doesNotMatch(text, /express\.Router\(|\bapp\.route\(|\bapp\[\s*['"`]?(post|put|patch|delete|all)/, rel);
  }
});

test('every changing route the running App registers has a policy entry and a route test sample', async () => {
  await S.startServer();
  const { registeredRoutes } = require('../server');
  const registered = registeredRoutes();
  const scanned = [...new Set(scannedRoutes().flatMap((r) => (r.dynamic ? registered.filter((k) => P.registers([r], k)) : [r.key])))].sort();
  assert.deepEqual(registered, scanned, 'the source scan and the running App list the same changing routes');
  assert.deepEqual(scannedRoutes().filter((r) => r.dynamic && !registered.some((k) => P.registers([r], k))).map((r) => r.key), [], 'every templated route registers');
  const sampled = new Set(SAMPLES.map((s) => s.key));
  assert.deepEqual(registered.filter((k) => !Object.hasOwn(P.ROUTE_POLICY, k)), [], 'registered without a policy entry');
  assert.deepEqual(registered.filter((k) => !sampled.has(k)), [], 'registered without a route test sample');
  const unregistered = Object.keys(P.ROUTE_POLICY).filter((k) => !k.startsWith('GET ') && !registered.includes(k));
  assert.deepEqual(unregistered.filter((k) => !P.ROUTE_POLICY[k].pendingMerge), [], 'policy entries with no route that are not waiting for a lane merge');
});

function laneRoutes(commit) {
  const git = (...args) => execFileSync('git', args, { cwd: backend, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lib = git('ls-tree', '--name-only', `${commit}:app/backend/lib`).split('\n').filter((n) => n.endsWith('.js')).map((n) => `lib/${n}`);
  return ['server.js', 'implementRoutes.js', ...lib].flatMap((rel) => P.changingRoutesInSource(git('show', `${commit}:app/backend/${rel}`)));
}

test('every policy entry names a route this App registers, or one its named lane commit registers until the merge (no stale entry)', () => {
  const stale = P.staleEntries(everyRoute(), laneRoutes);
  assert.deepEqual(stale, []);
  const waiting = Object.values(P.ROUTE_POLICY).filter((e) => e.pendingMerge);
  assert.ok(waiting.every((e) => /^[0-9a-f]{7,40}$/.test(e.pendingMerge.commit) && e.pendingMerge.branch));
});

test('the stale-entry check fails on an entry nobody registers, a lane commit that does not register it, and a merged route that keeps its marker (must-fail)', () => {
  const lane = { branch: 'app-lane', commit: 'abc1234' };
  const routes = P.changingRoutesInSource("app.post('/api/kept', h);\napp.post(`/api/looped/${step}`, h);");
  const laneOf = (commit) => (commit === 'abc1234' ? P.changingRoutesInSource("app.post('/api/lane-route', h);") : []);
  const table = {
    'POST /api/kept': { rule: 'any', action: 'keep' },
    'POST /api/looped/save': { rule: 'any', action: 'loop' },
    'POST /api/lane-route': { rule: 'any', action: 'wait', pendingMerge: lane },
    'POST /api/gone': { rule: 'any', action: 'gone' },
    'POST /api/lane-typo': { rule: 'any', action: 'typo', pendingMerge: lane },
    'POST /api/looped/run': { rule: 'any', action: 'merged', pendingMerge: lane },
  };
  assert.deepEqual(P.staleEntries(routes, laneOf, table), [
    { key: 'POST /api/gone', why: 'no route registers it' },
    { key: 'POST /api/lane-typo', why: 'app-lane abc1234 does not register it either' },
    { key: 'POST /api/looped/run', why: 'the App registers it now, so drop pendingMerge app-lane' },
  ]);
});

test('every policy entry names a known rule and an action', () => {
  for (const [key, entry] of Object.entries(P.ROUTE_POLICY)) {
    assert.ok(Object.hasOwn(P.RULES, entry.rule), `${key}: unknown rule ${entry.rule}`);
    assert.ok(entry.action && !/[.]$/.test(entry.action), `${key}: action must be a phrase`);
    if (['launcher', 'owners'].includes(entry.rule)) assert.equal(typeof entry.target, 'function', `${key}: needs a target`);
  }
});

test('a route registered without a policy entry is refused before its handler runs (must-fail)', async () => {
  const app = express();
  app.use(express.json());
  const policy = P.createRoutePolicy({ enforce: () => true, appName: () => 'x', appDatabase: () => 'a.b', personOf: () => 'p@x',
    personToken: () => '', readAcl: async () => ({ ok: true, data: {} }), readMe: async () => ({ ok: true, data: {} }),
    readLauncher: async () => null, readHistory: async () => [] });
  const guard = P.enforceRoutePolicy(app, policy);
  let ran = 0;
  app.post('/api/unlisted', (_req, res) => { ran += 1; res.json({ ok: true }); });
  app.post('/api/inspire/ack', (_req, res) => { ran += 1; res.json({ ok: true }); });
  assert.deepEqual(guard.registered(), ['POST /api/inspire/ack', 'POST /api/unlisted']);
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
  const post = (p) => realFetch(`http://127.0.0.1:${server.address().port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  try {
    const unlisted = await post('/api/unlisted');
    assert.equal(unlisted.status, 403);
    assert.match((await unlisted.json()).error, /no access rule/);
    assert.equal(ran, 0);
    assert.equal((await post('/api/inspire/ack')).status, 200);
    assert.equal(ran, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
