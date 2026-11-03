const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');

const SHELL = {
  'static/index.html': '<!doctype html><script type="module" src="./assets/app.js"></script>',
  'static/assets/app.js': 'console.log("shell")',
  'static/assets/index.css': 'body{}',
  'shell_core.py': 'print(1)',
};

function bundle(overrides = {}) {
  const k = S.showcaseKey;
  return {
    version: 1,
    id: 'taxi',
    title: 'NYC Taxi Operations',
    business: 'NYC Taxi Operations',
    summary: 'Use cases on the public taxi trips sample',
    session_id: '1001',
    inspire: {
      [k('GET', '/api/inspire/results', { session_id: '1001' })]: { status: 200, body: { results: { title: 'Taxi' } } },
      [k('GET', '/api/inspire/sessions', {})]: { status: 200, body: { sessions: [{ session_id: '1001' }] } },
    },
    mvps: {
      'N01-U01': {
        title: 'Detect fare irregularities',
        api: {
          [k('GET', '/api/app')]: { status: 200, body: { title: 'Fare desk' } },
          [k('POST', '/api/page', {}, { page: 'n01_u01', filters: {} })]: { status: 200, body: { kpis: [1] } },
          [k('POST', '/api/genie/ask', {}, { question: 'Which zones?', conversation_id: '' })]: { status: 200, body: { conversation_id: 'c1' } },
        },
      },
    },
    ...overrides,
  };
}

function dirWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-'));
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}

async function serve(files = { 'taxi.json': bundle() }, shellFiles = SHELL) {
  const errors = [];
  const reached = [];
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { dir: dirWith(files), shellFiles, log: { error: (m) => errors.push(m) } });
  app.all('/api/*rest', (req, res) => {
    reached.push(`${req.method} ${req.path}`);
    res.json({ real: true });
  });
  const srv = await listen(app);
  return { srv, errors, reached };
}

async function call(base, url, { method = 'GET', body, headers = {} } = {}) {
  const resp = await fetch(base + url, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = resp.headers.get('content-type') || '';
  return { status: resp.status, type, location: resp.headers.get('location'), data: type.includes('json') ? await resp.json() : await resp.text() };
}

const DEMO = { [S.SHOWCASE_HEADER]: 'taxi' };

test('showcaseKey drops the workspace settings, sorts the query and the body, and keeps everything else', () => {
  const a = S.showcaseKey('get', '/api/inspire/results', { warehouse_id: 'w1', session_id: '1001', inspire_database: 'main.x', b: '2', a: '1' });
  const b = S.showcaseKey('GET', '/api/inspire/results', { a: '1', b: '2', session_id: '1001', warehouse_id: 'other' });
  assert.equal(a, 'GET /api/inspire/results?a=1&b=2&session_id=1001');
  assert.equal(a, b);
  assert.notEqual(a, S.showcaseKey('GET', '/api/inspire/results', { a: '1', b: '2', session_id: '1002' }));
  assert.equal(S.showcaseKey('POST', '/api/page', {}, { page: 'p', filters: { z: 1, a: [2] } }), 'POST /api/page {"filters":{"a":[2],"z":1},"page":"p"}');
  assert.equal(S.showcaseKey('POST', '/api/page', {}, { filters: { a: [2], z: 1 }, page: 'p', warehouse_id: 'w' }), 'POST /api/page {"filters":{"a":[2],"z":1},"page":"p"}');
  assert.equal(S.showcaseKey('POST', '/api/refresh', {}, {}), 'POST /api/refresh');
  assert.equal(S.showcaseKey('GET', '/api/app', { q: '' }), 'GET /api/app');
});

test('a demo bundle must be complete before Inspire offers it', () => {
  assert.equal(S.showcaseProblem(bundle(), '/x/taxi.json'), '');
  assert.match(S.showcaseProblem(bundle({ version: 2 }), '/x/taxi.json'), /not version 1/);
  assert.match(S.showcaseProblem(bundle(), '/x/other.json'), /must be named taxi\.json/);
  assert.match(S.showcaseProblem(bundle({ id: 'Bad Id' }), '/x/Bad Id.json'), /no valid id/);
  assert.match(S.showcaseProblem(bundle({ session_id: '' }), '/x/taxi.json'), /no session_id/);
  assert.match(S.showcaseProblem(bundle({ inspire: { 'GET /x': { status: 200, body: {} } } }), '/x/taxi.json'), /not METHOD \/api/);
  assert.match(S.showcaseProblem(bundle({ inspire: { 'GET /api/x': { body: {} } } }), '/x/taxi.json'), /no status and body/);
  assert.match(S.showcaseProblem(bundle({ mvps: { 'N01-U01': { title: 'x', api: {} } } }), '/x/taxi.json'), /no answer for GET \/api\/app/);
  assert.match(S.showcaseProblem(bundle({ mvps: { '../x': { title: 'x', api: {} } } }), '/x/taxi.json'), /MVP id/);
});

test('the demo list names each demo and the address of each hosted MVP', async () => {
  const { srv, errors } = await serve();
  try {
    const got = await call(srv.url, '/api/showcase');
    assert.equal(got.status, 200);
    assert.deepEqual(got.data.showcases, [{
      id: 'taxi', title: 'NYC Taxi Operations', business: 'NYC Taxi Operations', summary: 'Use cases on the public taxi trips sample',
      session_id: '1001', mvps: [{ id: 'N01-U01', title: 'Detect fare irregularities', url: '/showcase/taxi/mvp/N01-U01/' }],
    }]);
    assert.equal(got.data.error, undefined);
    assert.deepEqual(errors, []);
  } finally {
    await srv.close();
  }
});

test('a demo request gets the saved answer and never reaches the workspace routes', async () => {
  const { srv, reached } = await serve();
  try {
    const got = await call(srv.url, '/api/inspire/results?inspire_database=showcase&warehouse_id=showcase&session_id=1001', { headers: DEMO });
    assert.equal(got.status, 200);
    assert.deepEqual(got.data, { results: { title: 'Taxi' } });
    const missing = await call(srv.url, '/api/inspire/usecases?session_id=1001', { headers: DEMO });
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, S.SHOWCASE_MISSING);
    assert.equal(missing.data.showcase, true);
    for (const [method, url] of [['POST', '/api/inspire/implement/submit'], ['POST', '/api/inspire/feedback'], ['DELETE', '/api/inspire/session?session_id=1001'], ['POST', '/api/run/5/cancel']]) {
      const refused = await call(srv.url, url, { method, body: method === 'POST' ? { session_id: '1001' } : undefined, headers: DEMO });
      assert.equal(refused.status, 403, `${method} ${url}`);
      assert.equal(refused.data.error, S.SHOWCASE_READ_ONLY);
    }
    const unknown = await call(srv.url, '/api/inspire/results?session_id=1001', { headers: { [S.SHOWCASE_HEADER]: 'nope' } });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.error, S.SHOWCASE_UNKNOWN);
    assert.deepEqual(reached, []);
    const real = await call(srv.url, '/api/inspire/results?session_id=1001');
    assert.deepEqual(real.data, { real: true });
    assert.deepEqual(reached, ['GET /api/inspire/results']);
  } finally {
    await srv.close();
  }
});

test('a demo MVP page may load scripts, styles, fonts and data only from the App itself, so the demo fetches nothing from an internet host behind any proxy', async () => {
  const { sameOriginCsp } = require('../lib/hostedRun');
  const { srv } = await serve();
  try {
    const allowed = (csp) => csp.split('; ').filter((d) => /^(default|script|style|img|font|connect)-src /.test(d))
      .flatMap((d) => d.split(' ').slice(1)).filter((src) => !["'none'", "'self'", 'data:'].includes(src));
    for (const asked of ['/showcase/taxi/mvp/N01-U01/', '/showcase/taxi/mvp/N01-U01/assets/app.js']) {
      const csp = (await fetch(`${srv.url}${asked}`)).headers.get('content-security-policy') || '';
      assert.equal(csp, sameOriginCsp(), asked);
      assert.match(csp, /(^|; )font-src 'self'(;|$)/);
      assert.deepEqual(allowed(csp), [], asked);
    }
    assert.deepEqual(allowed(`${sameOriginCsp()}; style-src https://fonts.googleapis.com`), ['https://fonts.googleapis.com'], 'an internet source is caught');
  } finally {
    await srv.close();
  }
});

test('a hosted MVP serves the App shell under its own address and answers its API from the saved answers', async () => {
  const { srv, reached } = await serve();
  try {
    const bare = await call(srv.url, '/showcase/taxi/mvp/N01-U01');
    assert.equal(bare.status, 302);
    assert.equal(bare.location, '/showcase/taxi/mvp/N01-U01/');
    const page = await call(srv.url, '/showcase/taxi/mvp/N01-U01/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.equal(page.data, SHELL['static/index.html']);
    const js = await call(srv.url, '/showcase/taxi/mvp/N01-U01/assets/app.js');
    assert.match(js.type, /text\/javascript/);
    assert.equal(js.data, SHELL['static/assets/app.js']);
    const css = await call(srv.url, '/showcase/taxi/mvp/N01-U01/assets/index.css');
    assert.match(css.type, /text\/css/);
    assert.equal((await call(srv.url, '/showcase/taxi/mvp/N01-U01/shell_core.py')).status, 404);
    assert.equal((await call(srv.url, '/showcase/taxi/mvp/N09-U09/')).status, 404);
    assert.equal((await call(srv.url, '/showcase/other/mvp/N01-U01/')).status, 404);

    const base = '/showcase/taxi/mvp/N01-U01/api';
    assert.deepEqual((await call(srv.url, `${base}/app`)).data, { title: 'Fare desk' });
    assert.deepEqual((await call(srv.url, `${base}/page`, { method: 'POST', body: { filters: {}, page: 'n01_u01' } })).data, { kpis: [1] });
    const other = await call(srv.url, `${base}/page`, { method: 'POST', body: { filters: { zone: ['A'] }, page: 'n01_u01' } });
    assert.equal(other.status, 404);
    assert.equal(other.data.error, S.SHOWCASE_MISSING);
    assert.deepEqual((await call(srv.url, `${base}/genie/ask`, { method: 'POST', body: { question: 'Which zones?', conversation_id: '' } })).data, { conversation_id: 'c1' });
    const asked = await call(srv.url, `${base}/genie/ask`, { method: 'POST', body: { question: 'Something else', conversation_id: '' } });
    assert.equal(asked.status, 404);
    assert.equal(asked.data.error, S.SHOWCASE_GENIE);
    for (const route of ['records/act', 'refresh', 'money/assumption', 'alerts/save', 'records/update']) {
      const refused = await call(srv.url, `${base}/${route}`, { method: 'POST', body: { page: 'n01_u01' } });
      assert.equal(refused.status, 403, route);
      assert.equal(refused.data.error, S.SHOWCASE_READ_ONLY);
    }
    assert.deepEqual(reached, []);
  } finally {
    await srv.close();
  }
});

test('a broken demo bundle turns the demo off without stopping the Inspire App', async () => {
  const { srv, errors, reached } = await serve({ 'taxi.json': '{not json' });
  try {
    const got = await call(srv.url, '/api/showcase');
    assert.equal(got.status, 200);
    assert.deepEqual(got.data.showcases, []);
    assert.match(got.data.error, /taxi\.json is not valid JSON/);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^The demo is off: /);
    const demo = await call(srv.url, '/api/inspire/results?session_id=1001', { headers: DEMO });
    assert.equal(demo.status, 404);
    assert.deepEqual(reached, []);
  } finally {
    await srv.close();
  }
});

test('a text answer replays as plain text with nosniff, and a text answer with no text body is refused', async () => {
  const k = S.showcaseKey;
  const notebook = { [k('GET', '/api/workspace/export', { path: '/Workspace/Shared/n01.py' })]: { status: 200, body: '<b>SELECT 1</b>', text: true } };
  const { srv } = await serve({ 'taxi.json': bundle({ inspire: { ...bundle().inspire, ...notebook } }) });
  try {
    const resp = await fetch(`${srv.url}/api/workspace/export?path=${encodeURIComponent('/Workspace/Shared/n01.py')}`, { headers: DEMO });
    assert.equal(resp.status, 200);
    assert.match(resp.headers.get('content-type'), /^text\/plain; charset=utf-8/);
    assert.equal(resp.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await resp.text(), '<b>SELECT 1</b>');
    const json = await call(srv.url, '/api/inspire/results?session_id=1001', { headers: DEMO });
    assert.match(json.type, /application\/json/);
  } finally {
    await srv.close();
  }
  const bad = { 'GET /api/workspace/export': { status: 200, body: { content: 'x' }, text: true } };
  assert.match(S.showcaseProblem(bundle({ inspire: bad }), '/x/taxi.json'), /is a text answer without a text body/);
  assert.match(S.showcaseProblem(bundle({ inspire: { 'GET /api/x': { status: 200, body: 'x', text: 'yes' } } }), '/x/taxi.json'), /text answer/);
});

function rawPost(url, headers, chunk) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers }, (resp) => {
      let text = '';
      resp.on('data', (c) => { text += c; });
      resp.on('end', () => { req.destroy(); resolve({ status: resp.statusCode, text }); });
    });
    req.on('error', (err) => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? undefined : reject(err)));
    req.write(chunk);
  });
}

test('in the real App every demo change gets the read-only answer before its body is read, and a request outside the demo still gets its own 400', async () => {
  const { fakeWorkspace, startInspire } = require('./support/serverProcess');
  const workspace = await fakeWorkspace(() => null);
  let inspire = null;
  const refused = { error: S.SHOWCASE_READ_ONLY, showcase: true };
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, DATABRICKS_TOKEN: 'test-token' });
    const cases = [
      ['malformed JSON', '/api/inspire/feedback', { ...DEMO, 'Content-Type': 'application/json' }, '{not json'],
      ['a wrong content type', '/api/inspire/implement/submit', { ...DEMO, 'Content-Type': 'text/plain' }, 'not a spec'],
      ['malformed JSON on a delete', '/api/inspire/session?session_id=1001', { ...DEMO, 'Content-Type': 'application/json' }, '{', 'DELETE'],
      ['malformed JSON to a hosted MVP App', '/showcase/taxi/mvp/N01-U01/api/records/act', { 'Content-Type': 'application/json' }, '{'],
    ];
    for (const [what, url, headers, body, method = 'POST'] of cases) {
      const resp = await fetch(inspire.url + url, { method, headers, body });
      assert.equal(resp.status, 403, what);
      assert.match(resp.headers.get('content-type'), /application\/json/, what);
      assert.deepEqual(await resp.json(), refused, what);
    }
    const oversize = await rawPost(`${inspire.url}/api/inspire/implement/rerun`, { ...DEMO, 'Content-Type': 'application/json', 'Content-Length': 60000000 }, '{"overrides":');
    assert.deepEqual([oversize.status, JSON.parse(oversize.text)], [403, refused], 'a body over the 50 MB limit is never read');
    const plain = await fetch(`${inspire.url}/api/inspire/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
    assert.equal(plain.status, 400, 'outside the demo malformed JSON still gets the parser 400');
    assert.doesNotMatch(await plain.text(), /This is the demo/);
    const read = await fetch(`${inspire.url}/api/inspire/results?session_id=1001`, { headers: DEMO });
    assert.deepEqual([read.status, (await read.json()).error], [404, S.SHOWCASE_UNKNOWN], 'a demo read still goes to the replay');
    assert.deepEqual(workspace.calls, [], 'no demo request reached the workspace');
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
});

test('the write guard refuses every change before any parser and lets reads, Genie questions and requests outside the demo through', () => {
  const run = (method, path, headers = {}) => {
    let passed = false;
    const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    S.showcaseWriteGuard({ method, path, get: (name) => headers[name.toLowerCase()] }, res, () => { passed = true; });
    return passed ? 'next' : [res.code, res.body.error];
  };
  const demo = { [S.SHOWCASE_HEADER]: 'taxi' };
  assert.deepEqual(run('POST', '/api/inspire/feedback', demo), [403, S.SHOWCASE_READ_ONLY]);
  assert.deepEqual(run('PUT', '/api/page', demo), [403, S.SHOWCASE_READ_ONLY]);
  assert.deepEqual(run('POST', '/showcase/taxi/mvp/N01-U01/api/alerts/save'), [403, S.SHOWCASE_READ_ONLY]);
  for (const [method, path, headers] of [['GET', '/api/inspire/results', demo], ['POST', '/api/inspire/implement/readiness', demo],
    ['POST', '/showcase/taxi/mvp/N01-U01/api/page'], ['POST', '/showcase/taxi/mvp/N01-U01/api/genie/ask'], ['POST', '/api/inspire/feedback'],
    ['POST', '/run/n01-u01/api/records/act'], ['GET', '/showcase/taxi/mvp/N01-U01/']]) {
    assert.equal(run(method, path, headers), 'next', `${method} ${path}`);
  }
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(server.indexOf('app.use(showcaseWriteGuard);') > 0 && server.indexOf('app.use(showcaseWriteGuard);') < server.indexOf('app.use(express.json('),
    'the App refuses demo changes before it parses any body');
});

test('showcaseMiss tells reads, Genie questions and changes apart', () => {
  assert.deepEqual(S.showcaseMiss('GET', '/api/runs'), { status: 404, error: S.SHOWCASE_MISSING });
  assert.deepEqual(S.showcaseMiss('POST', '/api/records'), { status: 404, error: S.SHOWCASE_MISSING });
  assert.deepEqual(S.showcaseMiss('POST', '/api/genie/ask'), { status: 404, error: S.SHOWCASE_GENIE });
  assert.deepEqual(S.showcaseMiss('POST', '/api/records/act'), { status: 403, error: S.SHOWCASE_READ_ONLY });
  assert.deepEqual(S.showcaseMiss('PUT', '/api/page'), { status: 403, error: S.SHOWCASE_READ_ONLY });
});

test('a hosted MVP serves the fonts the App shell carries as font/woff2 bytes, and nothing else under its fonts folder', async () => {
  const font = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0xff, 0x00, 0x80]);
  const { srv } = await serve(undefined, { ...SHELL, 'static/assets/fonts/inter-latin-wght-normal.woff2': font, 'static/assets/fonts/inter-LICENSE': 'OFL' });
  try {
    const resp = await fetch(`${srv.url}/showcase/taxi/mvp/N01-U01/assets/fonts/inter-latin-wght-normal.woff2`);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'font/woff2');
    assert.deepEqual(Buffer.from(await resp.arrayBuffer()), font);
    for (const missing of ['assets/fonts/newsreader-latin-opsz-normal.woff2', 'assets/fonts/inter-LICENSE', 'assets/fonts/..%2F..%2Fshell_core.py',
      'assets/fonts/Inter.woff2', 'assets/fonts/inter-latin-wght-normal.woff2.map']) {
      assert.equal((await fetch(`${srv.url}/showcase/taxi/mvp/N01-U01/${missing}`)).status, 404, missing);
    }
  } finally {
    await srv.close();
  }
});

test('the App shell files carry its binary fonts as bytes, and a shell whose binary files cannot be read is refused with the fix', () => {
  const zlib = require('zlib');
  const { appShellFiles, appShellPayload, bundledAppShellText } = require('../lib/appShell');
  const notebook = (data) => zlib.deflateSync(Buffer.from(JSON.stringify(data))).toString('base64');
  const base = { version: 1, files: { 'static/index.html': '<html>' } };
  const font = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0xff]);
  const shell = appShellPayload(notebook({ ...base, binary: { 'static/assets/fonts/a.woff2': font.toString('base64') } }));
  assert.deepEqual(appShellFiles(shell), { 'static/index.html': '<html>', 'static/assets/fonts/a.woff2': font });
  assert.deepEqual(appShellFiles(appShellPayload(notebook(base))), { 'static/index.html': '<html>' }, 'a shell with no binary files still loads');
  for (const binary of [[], 'x', null, { 'static/assets/fonts/a.woff2': 5 }]) {
    assert.throws(() => appShellPayload(notebook({ ...base, binary })),
      /^Error: the bundled App shell carries binary files Inspire cannot read; update the Inspire App so it carries an agent notebook with the App shell$/,
      JSON.stringify(binary));
  }
  const bundled = appShellFiles(appShellPayload(bundledAppShellText()));
  assert.equal(typeof bundled['static/index.html'], 'string');
  assert.ok(Object.values(bundled).every((body) => typeof body === 'string' || Buffer.isBuffer(body)));
});

test('the demo serves every typed file of the App shell with its own type and nosniff, and refuses a file with no type', async () => {
  const { ASSET_TYPES } = require('../lib/assetTypes');
  const { appShellFiles, appShellPayload, bundledAppShellText } = require('../lib/appShell');
  const embedded = Object.fromEntries(Object.entries(appShellFiles(appShellPayload(bundledAppShellText()))).filter(([name]) => name.startsWith('static/')));
  const samples = Object.fromEntries(Object.keys(ASSET_TYPES).map((ext) => [`static/assets/sample${ext}`, Buffer.from('x')]));
  const shell = { ...embedded, ...samples, 'static/block-1a2b3c.webp': Buffer.from('RIFF0000WEBP'), 'static/assets/fonts/inter-LICENSE': 'OFL',
    'static/notes.txt': 'alert(1)', 'static/run.py': 'alert(1)', 'shell_core.py': 'print(1)' };
  const { srv } = await serve(undefined, shell);
  const base = `${srv.url}/showcase/taxi/mvp/N01-U01/`;
  try {
    const typed = Object.keys(shell).filter((name) => name.startsWith('static/') && ASSET_TYPES[path.extname(name).toLowerCase()]);
    assert.ok(typed.length >= Object.keys(ASSET_TYPES).length + 3, typed.join(' '));
    for (const name of typed) {
      const rel = name === 'static/index.html' ? '' : name.slice('static/'.length);
      const resp = await fetch(base + rel);
      assert.equal(resp.status, 200, name);
      assert.equal(resp.headers.get('content-type'), ASSET_TYPES[path.extname(name).toLowerCase()], name);
      assert.equal(resp.headers.get('x-content-type-options'), 'nosniff', name);
      await resp.arrayBuffer();
    }
    for (const rel of ['assets/fonts/inter-LICENSE', 'notes.txt', 'run.py', 'shell_core.py', '..%2Fshell_core.py', '.hidden.js', 'assets//app.js']) {
      const resp = await fetch(base + rel);
      const text = await resp.text();
      assert.equal(resp.status, 404, rel);
      assert.equal(resp.headers.get('x-content-type-options'), 'nosniff', rel);
      assert.ok(!text.includes('alert(1)') && !text.includes('print(1)'), rel);
    }
  } finally {
    await srv.close();
  }
});
