const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { match } = require('path-to-regexp');
const S = require('./support/serverApp');

const BACKEND = path.resolve(__dirname, '..');
const LITERAL = /\bapp\.(get|post|put|patch|delete|all)\(\s*(['"`])(.*?)\2/g;
const MOUNT = /(?<!function )\b(register\w*Routes)\(app\b/g;
const GUARD = /\bapp\.param\(\s*'(\w+)'/g;

test.after(() => S.stopServer());

function mountedFile(dir, text, name) {
  const required = [...text.matchAll(/const \{([^}]*)\} = require\('(\.[^']+)'\)/g)]
    .find((m) => m[1].split(',').map((s) => s.split(':').pop().trim()).includes(name));
  if (!required) throw new Error(`${name} is called but not required`);
  return require.resolve(path.resolve(dir, required[2]));
}

function routesInOrder(file) {
  const text = fs.readFileSync(file, 'utf8');
  const marks = [...text.matchAll(LITERAL)].map((m) => ({ at: m.index, method: m[1].toUpperCase(), path: m[3], file: path.basename(file) }));
  for (const m of text.matchAll(MOUNT)) marks.push({ at: m.index, mount: mountedFile(path.dirname(file), text, m[1]) });
  return marks.sort((a, b) => a.at - b.at).flatMap((m) => (m.mount ? routesInOrder(m.mount) : [m]));
}

function digitGuards(file) {
  return new Set([...fs.readFileSync(file, 'utf8').matchAll(GUARD)].map((m) => m[1]));
}

function shadowed(routes, guarded) {
  const hits = [];
  routes.forEach((later, j) => {
    if (/[:*{]/.test(later.path)) return;
    for (const earlier of routes.slice(0, j)) {
      if (!/[:*]/.test(earlier.path) || (earlier.method !== 'ALL' && earlier.method !== later.method)) continue;
      const found = match(earlier.path)(later.path);
      if (!found) continue;
      const passes = Object.entries(found.params).some(([name, value]) => guarded.has(name) && !/^\d+$/.test(String(value)));
      if (!passes) hits.push(`${later.method} ${later.path} (${later.file}) is caught by ${earlier.method} ${earlier.path} (${earlier.file})`);
    }
  });
  return hits;
}

test('no fixed route the App registers is caught by an earlier route with a parameter, across server.js and every route file it mounts', () => {
  const server = path.join(BACKEND, 'server.js');
  const routes = routesInOrder(server);
  assert.ok(routes.length >= 70, `${routes.length} routes`);
  const at = (key) => routes.findIndex((r) => `${r.method} ${r.path}` === key);
  assert.ok(at('GET /api/run/:runId') >= 0 && at('GET /api/run/:runId') < at('GET /api/run/pages'), 'the scan sees the run routes in the order the App registers them');
  assert.ok(digitGuards(server).has('runId'));
  assert.deepEqual(shadowed(routes, digitGuards(server)), []);
});

test('the order scan reports a parameter route that catches a later fixed route, and passes it only when the parameter takes digits alone (must-fail)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-order-'));
  const main = path.join(dir, 'server.js');
  fs.writeFileSync(path.join(dir, 'more.js'), "function registerMoreRoutes(app) {\n  app.get('/api/run/pages', handler);\n  app.post('/api/run/pages', handler);\n}\n");
  fs.writeFileSync(main, [
    "const { registerMoreRoutes } = require('./more');",
    "app.get('/api/run/:runId', handler);",
    "app.all('/api/thing/:name', handler);",
    'registerMoreRoutes(app);',
    "app.get('/api/thing/list', handler);",
    "app.get('/api/early', handler);",
    "app.get('/api/:anything', handler);",
  ].join('\n'));
  const routes = routesInOrder(main);
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`),
    ['GET /api/run/:runId', 'ALL /api/thing/:name', 'GET /api/run/pages', 'POST /api/run/pages', 'GET /api/thing/list', 'GET /api/early', 'GET /api/:anything']);
  assert.deepEqual(shadowed(routes, new Set()), [
    'GET /api/run/pages (more.js) is caught by GET /api/run/:runId (server.js)',
    'GET /api/thing/list (server.js) is caught by ALL /api/thing/:name (server.js)',
  ]);
  assert.deepEqual(shadowed(routes, new Set(['runId'])), ['GET /api/thing/list (server.js) is caught by ALL /api/thing/:name (server.js)']);
  fs.rmSync(dir, { recursive: true, force: true });
});

const runsGet = () => S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/get');

test('the Run tab list reaches the deployed use case reader, never the jobs API as a run named pages', async () => {
  S.reset();
  const got = await S.request('GET', `/api/run/pages?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}`);
  assert.deepEqual(runsGet(), [], 'no jobs API call');
  assert.doesNotMatch(got.text, /does not exist|no record of run pages/i, got.text);
  assert.equal(got.status, 200, got.text);
  assert.ok(Array.isArray(got.data.pages), got.text);
  assert.ok(S.state.calls.some((c) => c.statement.includes('__inspire_implement')), 'the deployed use case reader ran');
});

test('a run id of digits still reads the run, and any other run segment is an unknown API route that reaches no workspace API (must-exclude)', async () => {
  S.reset({ managers: ['boss@example.com'], launchers: { 77: 'boss@example.com' } });
  const run = await S.request('GET', '/api/run/77', { person: 'boss@example.com' });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(runsGet().map((c) => c.query), ['?run_id=77']);
  for (const url of ['/api/run/abc', '/api/run/pages2', '/api/run/12a', '/api/run/abc/output', '/api/run/abc/cancel', '/api/run/-1']) {
    for (const method of url.endsWith('/cancel') ? ['GET', 'POST'] : ['GET']) {
      S.reset({ managers: ['boss@example.com'] });
      const got = await S.request(method, url, { person: 'boss@example.com', body: method === 'POST' ? {} : undefined });
      assert.equal(got.status, 404, `${method} ${url}: ${got.text}`);
      assert.match(got.data.error, /^Inspire has no API route /, url);
      assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/')), [], `${method} ${url}`);
    }
  }
});
