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
  'GET /api/inspire/profiles': 'lists the business profiles the App shares; the Start and Launch UI tests drive it through the mock App, and businessProfileRoutes.test.js proves the saves, the 409 refusal and the links',
  'GET /api/inspire/profiles/:profileId': 'reads one business profile the App shares; businessProfileRoutes.test.js proves the 400 and 404 refusals and the stored settings',
  'POST /api/inspire/profiles': 'saves a business profile the App shares; the Launch save dialog UI tests drive it through the mock App, and businessProfileRoutes.test.js proves the 409 and 400 refusals',
  'POST /api/run/check': 'the Launch pre-check that reads the grants a run needs and starts nothing; the Permission Required UI tests walk it through Launch',
  'GET /api/inspire/value/estimates': 'reads the session with the person\u2019s own sign-in and the Measure rules and KPI baselines; inspireValueRoutes.test.js drives it through the fake warehouse, including the sibling, no-number and own-baseline cases',
  'GET /api/inspire/implement/table-lookup': 'reads one table with the person\u2019s own sign-in and its column match; no non-owner harness row walks it yet, and implementTableReads.test.js proves the sign-in refusal and the must-exclude',
  'GET /api-docs': 'the static page that renders the API description, with no workspace data',
  'GET /api/openapi.json': 'the static API description file, with no workspace data',
  'POST /api/inspire/implement/preflight': 'the wizard posts the spec it is about to send to the same check the GET runs; the GET walk rows cover the check, and the parity route tests post the spec',
  'POST /api/inspire/implement/settings/preview': 'previews a settings change and changes nothing; no non-owner harness row walks it yet',
  'GET /api/inspire/implement/usecase-assets': 'reads the tracking table as the App and lists which assets each use case has; useCaseAssets.test.js drives it through the fake warehouse and no non-owner harness row walks it yet',
  'GET /api/inspire/implement/usecase-dbus': 'reads the tracking table and system.billing.usage as the App and totals the DBUs of each use case; useCaseAssets.test.js drives the totals, the denied read and the grant offer, and no non-owner harness row walks it yet',
  'GET /api/inspire/implement/runs': 'reads the last two runs of a built use case from its App with the person\u2019s own sign-in; no non-owner harness row walks it yet',
  'POST /api/inspire/implement/alerts/preview': 'previews an alert and changes nothing; no non-owner harness row walks it yet',
  'POST /api/inspire/implement/alerts/pause': 'pauses an alert; no non-owner harness row walks it yet, and the route samples prove the owners refusal',
  'POST /api/inspire/samples/copy': 'copies samples tables only with the person own sign-in, into a schema the person names; no non-owner harness row walks it yet, and the route samples and samplesCopy tests prove the sign-in refusal and the copy',
  'POST /api/inspire/implement/grant-access': 'runs grants only with the person own sign-in; no non-owner harness row walks it yet, and the route samples prove the sign-in refusal',
  'POST /api/inspire/implement/app-reads': 'runs only the read grants the build recorded for its App, with the person own sign-in; no non-owner harness row walks it yet, and the route tests prove the sign-in refusal',
  'POST /api/inspire/implement/create-schema': 'creates a catalog or schema as the App, and records the signed-in person as the requester; no non-owner harness row walks it yet, and the route tests prove the App create and the requester record',
  'GET /api/inspire/implement/feedback': 'lists the issues reported from a built use case’s App, each person seeing only their own; no non-owner harness row walks it yet, and the feedback route tests prove the per-person view',
  'POST /api/inspire/implement/feedback/status': 'changes the status of a reported issue for owners only; no non-owner harness row walks it yet, and the route samples prove the owners refusal',
  'POST /api/inspire/implement/feedback/vibe': 'drafts a vibe from a reported issue for owners only; no non-owner harness row walks it yet, and the route samples prove the owners refusal',
  'POST /api/inspire/usecase-name': 'renames a use case on its session row only, never the catalogue name or the result table; no non-owner harness row walks it yet, and the route samples and backend/test/useCaseName.test.js prove the input refusals',
  'POST /api/grouping/profile': 'reads the use case table with the person token only and changes nothing; the grouping route tests walk it',
  'POST /api/money/currency-rates': 'reads the currencies of a use case table and their rates with the person’s own sign-in and changes nothing; no non-owner harness row walks it yet, and the route samples prove the sign-in refusal',
  'POST /api/money/describe-value': 'turns a description into a value rule with a chat model the person can use, changes nothing; no non-owner harness row walks it yet, and the route samples prove the sign-in refusal',
  'GET /api/inspire/value/yearly': 'reads the ledger, specs and source tables with the App\u2019s service principal and changes nothing; valueYearlyRoutes.test.js drives it through the fake warehouse',
  'POST /api/inspire/value/estimate': 'reads one sample of a use case table with the App\u2019s service principal and changes nothing; valueYearlyRoutes.test.js drives it, including the 400 and 422 refusals',
  'POST /api/inspire/score-refine': 'writes the refined score and its history row with the App\u2019s service principal; scoreRefine.test.js drives it through the fake warehouse, including every refusal',
  'POST /api/inspire/score-refine/undo': 'clears the refined score and writes the undo history row with the App\u2019s service principal; scoreRefine.test.js drives it through the fake warehouse',
  'POST /api/money/value-preview': 'reads three rows of a use case table through a money value with the person’s own sign-in and changes nothing; no non-owner harness row walks it yet, and the route samples prove the sign-in refusal',
  'POST /api/money/rate-sample': 'reads the rates of a money rule’s rate table with the person’s own sign-in and changes nothing; no non-owner harness row walks it yet, and the route samples prove the sign-in refusal',
  'GET /api/inspire/implement/diagnostics': 'reads the build through the same loadStatus read and person token as GET /api/inspire/implement/status, which the harness walks; no non-owner harness row walks it yet',
  'GET /api/inspire/log': 'reads the run log only for its launcher or an App manager; no non-owner harness row walks it yet, and the route samples prove the launcher refusal',
  'POST /api/run/:runId/again': 'launches a run again only for its launcher or an App manager; no non-owner harness row walks it yet, and the route samples and runAgain tests prove the launcher refusal',
  'POST /api/documents': 'rebuilds a session\'s documents only for its launcher or an App manager; the documentJob and launcher-refusal tests prove it',
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
    'GET /no/scope/excuse': { identity: 'person', scopes: [], noScope: 'no user scope covers this API at all' },
    'GET /no/identity': { rule: 'any' },
    'GET /odd/identity': { identity: 'both', why: 'reads the tracking tables of the App' },
    'GET /app/no/why': { identity: 'app', why: '' },
    'GET /person/no/scope': { identity: 'person', scopes: [] },
    'GET /person/no/list': { identity: 'person' },
  };
  assert.deepEqual(P.undeclaredIdentity([...Object.keys(table), 'GET /not/listed'], table),
    ['GET /app/no/why', 'GET /no/identity', 'GET /no/scope/excuse', 'GET /not/listed', 'GET /odd/identity', 'GET /person/no/list', 'GET /person/no/scope']);
  assert.deepEqual(P.undeclaredIdentity(['GET /ok/app', 'GET /ok/person'], table), []);
});

test('every person route takes its token through requireToken, so its declared identity picks the token', () => {
  const tails = registrationTails(mountedFiles(SERVER));
  const person = [...tails.keys()].filter((key) => P.ROUTE_POLICY[key] && P.ROUTE_POLICY[key].identity === 'person');
  // REQ-418: the person's own token is kept for who-did-what routes only; every data route reads as the App.
  assert.deepEqual(person.sort(), ['POST /api/access-request', 'POST /api/access-request/check', 'POST /api/inspire/implement/grant-access'], 'the who-did-what person routes');
  assert.deepEqual(person.filter((key) => !/^\s*,\s*(rejectUnsafeQueryPath\s*,\s*)?requireToken\b/.test(tails.get(key))), []);
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

// REQ-313, REQ-314: every route's failure goes through the shared access mapping (permissionError.js), so a denial is a 403 with the
// Permission Required payload and never a raw 500 or an echoed error. This gate reads the route files' source.
const ROUTE_SOURCES = [SERVER, path.join(BACKEND, 'implementRoutes.js')];
const RAW_FAILURE = /res\.status\(\s*500\s*\)|res\.status\([^)]*\)\.json\(\s*\{[^\n]*\b(err|e|error|e1)\.message\b(?![\s\S]{0,0})/;

function rawFailures(text) {
  return text.split('\n').map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => RAW_FAILURE.test(line) && !/PM_ERROR\./.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`);
}

test('no route answers a failure with a raw 500 or an echoed error message: every failure goes through permissionError.js (REQ-314)', () => {
  for (const file of ROUTE_SOURCES) {
    assert.deepEqual(rawFailures(fs.readFileSync(file, 'utf8')), [], path.basename(file));
  }
});

test('the failure gate convicts a raw 500 and an echoed error, and passes the shared mapping (must-fail, must-exclude)', () => {
  assert.equal(rawFailures("app.get('/x', (req, res) => {\n  res.status(500).json({ error: 'x' });\n});").length, 1);
  assert.equal(rawFailures("res.status(500).json({ ok: false, error: err.message });").length, 1);
  assert.equal(rawFailures('PM_ERROR.sendFailure(res, PM_ERROR.failureStatus(err), err.message);').length, 0);
  assert.equal(rawFailures("res.status(400).json({ error: 'Format: catalog.schema' });").length, 0);
});

// Every page reads its data with the one error path: a refusal from the route raises the Permission Required dialog (apiClient.responseError).
const FRONTEND_SRC = path.resolve(BACKEND, '..', 'frontend', 'src');
// A raw fetch that reads no workspace data, or is the shared helper itself, names its reason here.
const RAW_FETCH_EXEMPT = {
  'App.jsx': 'the showcase list and the sign-in token exchange; neither reads workspace data, and a failure is shown on its own page',
  'lib/apiClient.js': 'the shared helpers themselves: responseError and bootRead raise the dialog or the boot error',
  'pages/ConfigPage.jsx': 'reads the list of bundled notebook files; it reads no workspace data',
};

function rawFetchesWithoutRaise(root) {
  const out = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(root).filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f))) {
    const rel = path.relative(root, file);
    if (Object.hasOwn(RAW_FETCH_EXEMPT, rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\bfetch\(/.test(line)) return;
      const window = lines.slice(i, i + 6).join('\n');
      if (!/responseError|raisePermissions|makeApi/.test(window)) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

test('every frontend page raises the Permission Required dialog from a refused read, through responseError (REQ-313)', () => {
  assert.deepEqual(rawFetchesWithoutRaise(FRONTEND_SRC), []);
});

test('a page that reads with a raw fetch and no raise is convicted, and a page that raises is passed (must-fail, must-exclude)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raise-walk-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'pages', 'Silent.jsx'), "const r = await fetch('/api/x');\nif (!r.ok) return;\n");
  fs.writeFileSync(path.join(dir, 'pages', 'Raised.jsx'), "const r = await fetch('/api/x');\nif (!r.ok) await responseError(r.clone());\n");
  assert.deepEqual(rawFetchesWithoutRaise(dir), ['pages/Silent.jsx:1']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the dialog opens from the payload: a 403 that carries grants raises them, and a refusal with no grants raises nothing (behaviour)', async () => {
  const { pathToFileURL } = require('node:url');
  const api = await import(pathToFileURL(path.join(FRONTEND_SRC, 'lib', 'apiClient.js')).href);
  const bus = await import(pathToFileURL(path.join(FRONTEND_SRC, 'lib', 'permissionBus.js')).href);
  const raised = [];
  const unsubscribe = bus.subscribePermissions((permissions) => raised.push(permissions));
  try {
    const grants = [{ statements: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `amr@example.com`'], principal: 'amr@example.com' }];
    const err = await api.responseError(new Response(JSON.stringify({ error: 'denied', permissions: grants }), { status: 403 }));
    assert.equal(err.status, 403);
    assert.equal(raised.length, 1, 'the dialog is raised once');
    assert.deepEqual(raised[0], grants);
    await api.responseError(new Response(JSON.stringify({ error: 'missing' }), { status: 404 }));
    assert.equal(raised.length, 1, 'a refusal with no grants raises no dialog');
    await api.responseError(new Response(JSON.stringify({ error: 'denied', permissions: grants }), { status: 403 }), { raise: false });
    assert.equal(raised.length, 1, 'a probe that shows its own refusal does not raise');
  } finally {
    unsubscribe();
  }
});

// (d) REQ-220: a page shows one message for a refusal. The pages that show inline text read the refusal's dialog flag and skip it.
const ONE_MESSAGE_PAGES = ['pages/ChoosePage.jsx', 'pages/ResultsPage.jsx', 'components/SettingsPanel.jsx', 'components/TableBrowser.jsx', 'pages/SetupWizard.jsx'];

test('every page that shows refusal text beside the dialog reads the dialog flag, so only one message shows (REQ-220)', () => {
  for (const rel of ONE_MESSAGE_PAGES) {
    const text = fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8');
    assert.match(text, /\.dialog\b/, `${rel} reads the dialog flag`);
  }
});

test('the dialog flag is set only when the dialog was raised from the payload (behaviour, must-exclude)', async () => {
  const { pathToFileURL } = require('node:url');
  const api = await import(pathToFileURL(path.join(FRONTEND_SRC, 'lib', 'apiClient.js')).href);
  const bus = await import(pathToFileURL(path.join(FRONTEND_SRC, 'lib', 'permissionBus.js')).href);
  const unsubscribe = bus.subscribePermissions(() => {});
  try {
    const grants = [{ statements: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `amr@example.com`'], principal: 'amr@example.com' }];
    assert.equal((await api.responseError(new Response(JSON.stringify({ error: 'x', permissions: grants }), { status: 403 }))).dialog, true);
    assert.equal((await api.responseError(new Response(JSON.stringify({ error: 'x' }), { status: 403 }))).dialog, false, 'no grants, no dialog');
    assert.equal((await api.responseError(new Response(JSON.stringify({ error: 'x', permissions: grants }), { status: 403 }), { raise: false })).dialog, false, 'a probe raises nothing');
  } finally {
    unsubscribe();
  }
});
