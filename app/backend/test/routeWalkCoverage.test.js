const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = require('../lib/routePolicy');

const BACKEND = path.resolve(__dirname, '..');
const SERVER = path.join(BACKEND, 'server.js');
const WALK = require('./support/harnessWalk.json');
const NOT_WALKED = {
  'GET /api-docs': 'the static page that renders the API description, with no workspace data',
  'GET /api/openapi.json': 'the static API description file, with no workspace data',
  'POST /api/inspire/implement/settings/preview': 'previews a settings change and changes nothing; no non-owner harness row walks it yet',
  'POST /api/inspire/implement/alerts/preview': 'previews an alert and changes nothing; no non-owner harness row walks it yet',
  'POST /api/inspire/implement/alerts/pause': 'pauses an alert; no non-owner harness row walks it yet, and the route samples prove the owners refusal',
  'POST /api/inspire/implement/grant-access': 'runs grants only with the person own sign-in; no non-owner harness row walks it yet, and the route samples prove the sign-in refusal',
};
const LITERAL = /\bapp\.(get|post|put|patch|delete|all)\(\s*(['"`])(.*?)\2([^\n]*)/g;
const ANY = /\bapp\.(get|post|put|patch|delete|all)\(/g;

function mountedFiles(serverPath) {
  const text = fs.readFileSync(serverPath, 'utf8');
  const files = [serverPath];
  for (const m of text.matchAll(/const \{([^}]*)\} = require\('(\.[^']+)'\)/g)) {
    const names = m[1].split(',').map((s) => s.split(':').pop().trim());
    for (const name of names) {
      if (/^register\w*Routes$/.test(name) && new RegExp(`\\b${name}\\(app\\b`).test(text)) {
        files.push(require.resolve(path.resolve(path.dirname(serverPath), m[2])));
      }
    }
  }
  return files;
}

function registeredRoutes(files) {
  const routes = new Map();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const literal = [...text.matchAll(LITERAL)];
    if (literal.length !== [...text.matchAll(ANY)].length) throw new Error(`${path.basename(file)} registers a route whose path is not a string literal`);
    for (const m of literal) {
      if (m[3].includes('${')) throw new Error(`${path.basename(file)} registers a route whose path is built at run time: ${m[3]}`);
      routes.set(`${m[1].toUpperCase()} ${m[3]}`, path.relative(BACKEND, file));
    }
  }
  return routes;
}

function registrationTails(files) {
  const tails = new Map();
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(LITERAL)) tails.set(`${m[1].toUpperCase()} ${m[3]}`, m[4]);
  }
  return tails;
}

function missingFromWalk(routes, walked, excluded) {
  return [...routes.keys()].filter((key) => !Object.hasOwn(walked, key) && !Object.hasOwn(excluded, key)).sort();
}

test('the route list comes from the source of server.js and every route file it mounts', () => {
  const files = mountedFiles(SERVER).map((f) => path.relative(BACKEND, f));
  assert.deepEqual(files, ['server.js', 'implementRoutes.js', path.join('lib', 'showcase.js')]);
  const routes = registeredRoutes(mountedFiles(SERVER));
  for (const key of ['GET /api/run/:runId/cancel', 'POST /api/inspire/implement/rerun', 'ALL /showcase/:id/mvp/:mvp/api/*rest', 'GET {*path}']) {
    assert.ok(routes.has(key), key);
  }
  assert.ok(routes.size >= 70, `${routes.size} routes`);
});

test('every route the backend registers is walked by the non-owner harness or excluded here with a reason', () => {
  const missing = missingFromWalk(registeredRoutes(mountedFiles(SERVER)), WALK, NOT_WALKED);
  assert.deepEqual(missing, [], `not walked and not excluded:\n${missing.join('\n')}`);
});

test('a route in the exclusion list is not demanded by the walk, and a route in neither is reported (must-exclude, must-fail)', () => {
  const routes = new Map([['GET /static-thing', 'x'], ['POST /api/unwalked', 'x'], ['GET /api/walked', 'x']]);
  const walked = { 'GET /api/walked': ['R1'] };
  assert.deepEqual(missingFromWalk(routes, walked, { 'GET /static-thing': 'static' }), ['POST /api/unwalked']);
  assert.deepEqual(missingFromWalk(routes, walked, {}), ['GET /static-thing', 'POST /api/unwalked']);
});

test('every exclusion names a route the backend registers and gives a one-line reason', () => {
  const routes = registeredRoutes(mountedFiles(SERVER));
  for (const [key, why] of Object.entries(NOT_WALKED)) {
    assert.ok(routes.has(key), `${key} is excluded but no longer registered`);
    assert.ok(!Object.hasOwn(WALK, key), `${key} is both walked and excluded`);
    assert.match(why, /^[a-z][^\n]{10,}$/);
  }
});

test('the walk names each route as METHOD and path with the harness rows that walk it', () => {
  for (const [key, rows] of Object.entries(WALK)) {
    assert.match(key, /^(GET|POST|PUT|PATCH|DELETE|ALL) \S+$/, key);
    assert.ok(Array.isArray(rows) && rows.length > 0 && rows.every((r) => /^[A-Z][0-9]{2}[a-z]?$/.test(r)), `${key}: ${rows}`);
  }
});

test('every route the backend registers declares whose token it reads with, and each App route says why', () => {
  const routes = registeredRoutes(mountedFiles(SERVER));
  assert.deepEqual(P.undeclaredIdentity(routes.keys()), [], 'routes with no declared identity');
  const identities = [...routes.keys()].map((key) => P.ROUTE_POLICY[key].identity);
  assert.ok(identities.includes('person') && identities.includes('app'));
});

test('the identity check reports a route with no entry, no identity, an App route with no reason, a person route with no scope and an unexplained output exception (must-fail)', () => {
  const table = {
    'GET /ok/app': { identity: 'app', why: 'reads the tracking tables of the App' },
    'GET /ok/person': { identity: 'person', scopes: ['sql'] },
    'GET /ok/output': { identity: 'person', scopes: ['files'], sessionOutput: 'reads inside the recorded output folder of a session' },
    'GET /no/scope/excuse': { identity: 'person', scopes: [], noScope: 'no user scope covers this API at all' },
    'GET /output/no/why': { identity: 'person', scopes: ['files'], sessionOutput: '' },
    'GET /no/identity': { rule: 'any' },
    'GET /odd/identity': { identity: 'both', why: 'reads the tracking tables of the App' },
    'GET /app/no/why': { identity: 'app', why: '' },
    'GET /person/no/scope': { identity: 'person', scopes: [] },
    'GET /person/no/list': { identity: 'person' },
  };
  assert.deepEqual(P.undeclaredIdentity([...Object.keys(table), 'GET /not/listed'], table),
    ['GET /app/no/why', 'GET /no/identity', 'GET /no/scope/excuse', 'GET /not/listed', 'GET /odd/identity', 'GET /output/no/why', 'GET /person/no/list', 'GET /person/no/scope']);
  assert.deepEqual(P.undeclaredIdentity(['GET /ok/app', 'GET /ok/person', 'GET /ok/output'], table), []);
});

test('every person route takes its token through requireToken, so its declared identity picks the token', () => {
  const tails = registrationTails(mountedFiles(SERVER));
  const person = [...tails.keys()].filter((key) => P.ROUTE_POLICY[key] && P.ROUTE_POLICY[key].identity === 'person');
  assert.ok(person.length >= 10, `${person.length} person routes`);
  assert.deepEqual(person.filter((key) => !/^\s*,\s*requireToken\b/.test(tails.get(key))), []);
});

test('a registration whose path is not a literal, or is built at run time, fails the parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-walk-'));
  const variable = path.join(dir, 'variable.js');
  const built = path.join(dir, 'built.js');
  fs.writeFileSync(variable, "app.get(PATH, handler);\napp.post('/api/ok', handler);\n");
  fs.writeFileSync(built, 'app.get(`/api/${name}`, handler);\n');
  assert.throws(() => registeredRoutes([variable]), /not a string literal/);
  assert.throws(() => registeredRoutes([built]), /built at run time/);
  fs.rmSync(dir, { recursive: true, force: true });
});
