const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const express = require('express');
const H = require('../lib/hostedRun');

const OWNER = ['owner', 'example.com'].join('@');
const SECRETS = {
  DATABRICKS_CLIENT_ID: 'sp-client-id', DATABRICKS_CLIENT_SECRET: 'sp-client-secret', DATABRICKS_TOKEN: 'sp-static-token',
  SP_CLIENT_ID: 'sp-id', SP_CLIENT_SECRET: 'sp-secret', DATABRICKS_APP_NAME: 'inspire-ai', DATABRICKS_WORKSPACE_ID: '111122223333444',
  DATABRICKS_APP_PORT: '8000', INSPIRE_DATABASE: 'main.inspire', INSPIRE_WAREHOUSE_ID: 'wh1', NODE_ENV: 'production',
};
const PARENT_ENV = { ...SECRETS, PATH: '/usr/local/bin:/usr/bin:.venv/bin', HOME: '/home/app', LANG: 'en_US.UTF-8', DATABRICKS_HOST: 'https://workspace.example.com' };
const FORBIDDEN = Object.keys(SECRETS);

const record = (id, version = 1) => ({ id, source: `/Workspace/Users/someone/hosted/${id}/v${version}`, version, warehouse_id: 'wh2', page: 'n01_u01',
  published_at: `2026-10-3${version}T05:00:00Z` });
const entry = (rec) => ({ kind: 'inspire', id: rec.id, hosted: rec, owners: [OWNER] });

function fakeChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = [];
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    child.kills.push(signal);
    setImmediate(() => { child.signalCode = signal; child.emit('exit', null, signal); });
    return true;
  };
  return child;
}

function folderOf(rec, extra = []) {
  const root = rec.source;
  return {
    [root]: [{ path: `${root}/app.py`, object_type: 'FILE' }, { path: `${root}/static`, object_type: 'DIRECTORY' }, ...extra],
    [`${root}/static`]: [{ path: `${root}/static/index.html`, object_type: 'FILE' }],
  };
}

function fakeFiles(folders, reads) {
  return {
    async list(folder) {
      return folders[folder] || [];
    },
    async read(file) {
      reads.push(file);
      return Buffer.from(`content of ${path.basename(file)}`);
    },
  };
}

async function upstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader('Set-Cookie', 'child=1; Path=/');
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { seen, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function setup({ folders = {}, health = async () => true, max, idleMs, healthMs, retryMs } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-run-test-'));
  const spawned = [];
  const reads = [];
  const up = await upstream();
  const clock = { at: 1000 };
  const hosted = H.createHostedRun({
    spawn: (cmd, args, opts) => {
      const child = fakeChild();
      spawned.push({ cmd, args, opts, child });
      return child;
    },
    pickPython: async () => '/opt/venv/bin/python3',
    files: () => fakeFiles(folders, reads),
    tmpRoot: tmp,
    env: PARENT_ENV,
    cwd: '/app/source',
    now: () => clock.at,
    port: async () => up.port,
    checkHealth: health,
    pause: async () => { clock.at += 250; },
    ...(max ? { maxChildren: max } : {}),
    ...(idleMs ? { idleMs } : {}),
    ...(healthMs ? { healthMs } : {}),
    ...(retryMs != null ? { retryMs } : {}),
  });
  const app = express();
  app.all('/run/:id/{*rest}', (req, _res, next) => { req.dbHost = 'https://workspace.example.com'; req.dbToken = 'sp-token'; next(); }, hosted.proxy);
  app.get('/run/:id', hosted.redirect);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await up.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { hosted, spawned, reads, up, clock, tmp, base, close };
}

function call(base, url, { method = 'GET', headers = {}, body } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: hostname, port, path: url, method, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const TOKEN = { 'x-forwarded-access-token': 'user-token', 'x-forwarded-email': OWNER };

test('the page process gets only PATH, HOME, LANG, DATABRICKS_HOST and DATABRICKS_WAREHOUSE_ID, never a service principal credential', async () => {
  const rec = record('n01-u01-a');
  const s = await setup({ folders: folderOf(rec) });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    const got = await call(s.base, `/run/${rec.id}/health`, { headers: TOKEN });
    assert.equal(got.status, 200, got.text);
    assert.equal(s.spawned.length, 1);
    const [{ cmd, args, opts }] = s.spawned;
    assert.deepEqual([cmd, args.slice(0, 3), args.slice(3, 5)], ['/opt/venv/bin/python3', ['-m', 'uvicorn', 'app:app'], ['--host', '127.0.0.1']]);
    assert.deepEqual(Object.keys(opts.env).sort(), ['DATABRICKS_HOST', 'DATABRICKS_WAREHOUSE_ID', 'HOME', 'LANG', 'PATH']);
    for (const name of FORBIDDEN) assert.equal(Object.hasOwn(opts.env, name), false, `${name} reaches the page process`);
    for (const value of Object.values(SECRETS)) assert.ok(!Object.values(opts.env).some((v) => String(v).includes(value)), `${value} reaches the page process`);
    assert.equal(opts.env.DATABRICKS_WAREHOUSE_ID, 'wh2', 'the warehouse each viewer reads with');
    assert.equal(opts.env.DATABRICKS_HOST, PARENT_ENV.DATABRICKS_HOST);
    assert.notEqual(opts.env.HOME, PARENT_ENV.HOME, 'the page gets a home of its own, so no CLI config or token cache of the parent');
    assert.ok(opts.env.HOME.startsWith(s.tmp));
    assert.deepEqual(opts.env.PATH.split(path.delimiter), ['/opt/venv/bin', '/usr/local/bin', '/usr/bin', '/app/source/.venv/bin'],
      'the interpreter folder first and every relative folder made absolute');
    assert.equal(opts.cwd, path.join(s.tmp, rec.id, 'v1'));
    assert.deepEqual(opts.stdio, ['ignore', 'ignore', 'pipe']);
  } finally {
    await s.close();
  }
});

test('the proxy forwards only the whitelisted headers, strips cookie and authorization, and marks every answer with the page policy and nosniff', async () => {
  const rec = record('n01-u01-b');
  const s = await setup({ folders: folderOf(rec) });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    const body = '{"page":"n01_u01","id":2222222222222222222}';
    const got = await call(s.base, `/run/${rec.id}/api/records?x=1`, {
      method: 'POST', body,
      headers: {
        ...TOKEN, 'x-forwarded-user': 'u1', 'x-forwarded-preferred-username': 'Owner', 'content-type': 'application/json', accept: 'application/json',
        cookie: 'session=abc', authorization: 'Bearer sp-token', 'x-db-pat-token': 'pat', 'x-databricks-host': 'https://other.example.com',
        'x-forwarded-host': 'inspire.example.com', 'x-other': 'no', 'content-length': String(Buffer.byteLength(body)),
      },
    });
    assert.equal(got.status, 200, got.text);
    const [seen] = s.up.seen;
    assert.deepEqual([seen.method, seen.url, seen.body], ['POST', '/api/records?x=1', body], 'method, path, query and the exact body bytes');
    assert.deepEqual(Object.keys(seen.headers).sort(), ['accept', 'connection', 'content-length', 'content-type', 'host', 'x-forwarded-access-token',
      'x-forwarded-email', 'x-forwarded-preferred-username', 'x-forwarded-user']);
    for (const name of ['cookie', 'authorization', 'x-db-pat-token', 'x-databricks-host', 'x-forwarded-host', 'x-other']) {
      assert.equal(Object.hasOwn(seen.headers, name), false, `${name} reaches the page`);
    }
    assert.equal(got.headers['content-security-policy'], H.hostedCsp('https://inspire.example.com', rec.id), 'the policy names the host the browser asked for');
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.equal(got.headers['set-cookie'], undefined, 'a page never sets a cookie on the Inspire site');
  } finally {
    await s.close();
  }
});

test('with no forwarded token the proxy answers 401 with the plain reason and starts nothing', async () => {
  const rec = record('n01-u01-c');
  const s = await setup({ folders: folderOf(rec) });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    for (const headers of [{}, { 'x-forwarded-access-token': '' }, { authorization: 'Bearer sp-token', cookie: 'session=abc' }]) {
      const got = await call(s.base, `/run/${rec.id}/`, { headers });
      assert.deepEqual([got.status, got.text], [401, H.HOSTED_NO_TOKEN]);
      assert.equal(got.headers['content-security-policy'], H.hostedCsp(s.base, rec.id));
    }
    for (const url of ['/run/N01_BAD/', `/run/${rec.id}/static/%2e%2e/%2e%2e/secret`, `/run/${rec.id}`, '/run/n09-u09-z/', `/run/${rec.id}/api/app`]) {
      const got = await call(s.base, url, { headers: { cookie: 'session=abc' } });
      assert.deepEqual([got.status, got.text], [401, H.HOSTED_NO_TOKEN], `${url} is refused for the missing token before any other check`);
    }
    assert.equal(s.spawned.length, 0);
    assert.equal(H.HOSTED_NO_TOKEN,
      'Inspire needs permission to act as you to show this page; a workspace admin turns on user authorization for Apps, then reopen Inspire');
  } finally {
    await s.close();
  }
});

test('an id that breaks the pattern or names no live hosted record is refused, and the page path never climbs out', async () => {
  const rec = record('n01-u01-d');
  const s = await setup({ folders: folderOf(rec) });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    for (const id of ['N01-U01', 'a_b', `${'a'.repeat(64)}`, 'a.b']) {
      const got = await call(s.base, `/run/${encodeURIComponent(id)}/`, { headers: TOKEN });
      assert.equal(got.status, 404, id);
      assert.equal(got.text, 'there is no page with that id Inside Inspire', id);
    }
    const unknown = await call(s.base, '/run/n09-u09-z/', { headers: TOKEN });
    assert.deepEqual([unknown.status, unknown.text], [404, 'Inspire has no page n09-u09-z Inside Inspire; open it from the Run tab']);
    const climb = await call(s.base, `/run/${rec.id}/static/%2e%2e/%2e%2e/secret`, { headers: TOKEN });
    assert.equal(climb.status, 400);
    assert.equal(s.spawned.length, 0, 'nothing started for a refused request');
    const bare = await call(s.base, `/run/${rec.id}?x=1`, { headers: TOKEN });
    assert.deepEqual([bare.status, bare.headers.location], [301, `/run/${rec.id}/?x=1`], 'the page needs its trailing slash for its relative links');
  } finally {
    await s.close();
  }
});

test('a workspace path that leaves the page folder is refused and nothing is written outside the local copy', async () => {
  for (const bad of ['/Workspace/Users/someone/hosted/n01-u01-e/v1/../../escape.py', '/Workspace/Users/someone/other/app.py',
    '/Workspace/Users/someone/hosted/n01-u01-e/v1/static/./x', '/Workspace/Users/someone/hosted/n01-u01-e/v1/a\\..\\b']) {
    const rec = record('n01-u01-e');
    const s = await setup({ folders: folderOf(rec, [{ path: bad, object_type: 'FILE' }]) });
    try {
      s.hosted.setListed([entry(rec)], { key: 'db' });
      const got = await call(s.base, `/run/${rec.id}/`, { headers: TOKEN });
      assert.equal(got.status, 503, bad);
      assert.match(got.text, /^this page could not start: .*(outside the page folder|not a plain path)/, bad);
      assert.equal(s.spawned.length, 0, bad);
      assert.equal(s.hosted.stateOf(rec.id).state, 'failed');
      assert.ok(!fs.existsSync(path.join(s.tmp, '..', 'escape.py')) && !fs.existsSync(path.join(s.tmp, 'escape.py')), bad);
      assert.ok(!fs.existsSync(path.join(s.tmp, rec.id, 'v1')), 'a half copy is never used');
      assert.ok(!fs.existsSync(path.join(s.tmp, rec.id, '.v1.partial')), 'the half copy is deleted');
    } finally {
      await s.close();
    }
  }
  assert.throws(() => H.safeLocalPath('/tmp/x', '../y'), /would leave the local copy/);
  assert.equal(H.relativeSource('/Workspace/Users/a/v1', '/Users/a/v1/static/app.js'), 'static/app.js', 'the Workspace prefix may differ between list and record');
});

test('at most three pages run; the least recently used stops first when a fourth opens', async () => {
  const recs = ['n01-u01-f', 'n01-u02-f', 'n01-u03-f', 'n01-u04-f'].map((id) => record(id));
  const s = await setup({ folders: Object.assign({}, ...recs.map((r) => folderOf(r))) });
  try {
    s.hosted.setListed(recs.map(entry), { key: 'db' });
    for (const rec of recs.slice(0, 3)) {
      assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
      s.clock.at += 1000;
    }
    assert.equal((await call(s.base, `/run/${recs[0].id}/x`, { headers: TOKEN })).status, 200, 'the first page is used again, so it is no longer the oldest');
    s.clock.at += 1000;
    assert.equal((await call(s.base, `/run/${recs[3].id}/`, { headers: TOKEN })).status, 200);
    const states = recs.map((r) => s.hosted.stateOf(r.id).state);
    assert.deepEqual(states, ['ready', 'stopped', 'ready', 'ready']);
    assert.deepEqual(s.spawned[1].child.kills, ['SIGTERM'], 'the least recently used page is the one stopped');
    assert.match(s.hosted.stateOf(recs[1].id).reason, /to make room for another page/);
    assert.equal([...s.hosted.runs.values()].filter((r) => r.child).length, 3);
  } finally {
    await s.close();
  }
});

test('a page with no visit for 15 minutes stops, and the next visit starts it again', async () => {
  const rec = record('n01-u01-g');
  const s = await setup({ folders: folderOf(rec) });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
    s.clock.at += H.HOSTED_IDLE_MS - 1;
    s.hosted.sweep();
    assert.equal(s.hosted.stateOf(rec.id).state, 'ready', 'not idle yet');
    s.clock.at += 1;
    s.hosted.sweep();
    assert.equal(s.hosted.stateOf(rec.id).state, 'stopped');
    assert.match(s.hosted.stateOf(rec.id).reason, /15 minutes with no visits/);
    assert.deepEqual(s.spawned[0].child.kills, ['SIGTERM']);
    s.hosted.setListed([entry(rec)], { key: 'db' });
    assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
    assert.equal(s.spawned.length, 2);
  } finally {
    await s.close();
  }
});

test('a newly published version stops the page, copies the new folder, starts it again and drops the old copy', async () => {
  const v1 = record('n01-u01-h', 1);
  const v2 = record('n01-u01-h', 2);
  const s = await setup({ folders: { ...folderOf(v1), ...folderOf(v2) } });
  try {
    s.hosted.setListed([entry(v1)], { key: 'db' });
    assert.equal((await call(s.base, `/run/${v1.id}/`, { headers: TOKEN })).status, 200);
    assert.ok(fs.existsSync(path.join(s.tmp, v1.id, 'v1', 'app.py')));
    s.hosted.setListed([entry(v2)], { key: 'db' });
    assert.deepEqual(s.spawned[0].child.kills, ['SIGTERM'], 'the v1 page stops when v2 is published');
    assert.equal((await call(s.base, `/run/${v1.id}/`, { headers: TOKEN })).status, 200);
    assert.equal(s.spawned.length, 2);
    assert.equal(s.spawned[1].opts.cwd, path.join(s.tmp, v1.id, 'v2'));
    assert.ok(s.reads.some((f) => f.startsWith(v2.source)), 'the v2 folder is copied');
    assert.ok(!fs.existsSync(path.join(s.tmp, v1.id, 'v1')), 'the v1 copy is gone');
    assert.equal(s.hosted.runs.get(v1.id).version, 2);
  } finally {
    await s.close();
  }
});

test('a page that is no longer listed (uninstalled or moved to its own App) stops and its local copy is deleted', async () => {
  const rec = record('n01-u01-i');
  const other = record('n01-u02-i');
  const s = await setup({ folders: { ...folderOf(rec), ...folderOf(other) } });
  try {
    s.hosted.setListed([entry(rec), entry(other)], { key: 'db' });
    assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
    assert.ok(fs.existsSync(path.join(s.tmp, rec.id)));
    s.hosted.setListed([entry(other)], { key: 'another-db' });
    assert.equal(s.hosted.listed.has(rec.id), true, 'a listing of another Inspire database never drops this one');
    s.hosted.setListed([entry(other)], { key: 'db' });
    assert.deepEqual(s.spawned[0].child.kills, ['SIGTERM']);
    assert.equal(fs.existsSync(path.join(s.tmp, rec.id)), false);
    assert.equal(s.hosted.listed.has(rec.id), false);
    const gone = await call(s.base, `/run/${rec.id}/`, { headers: TOKEN });
    assert.equal(gone.status, 404);
  } finally {
    await s.close();
  }
});

test('a crashed page shows failed with its last 40 stderr lines, tokens stripped, to an owner only', async () => {
  const rec = record('n01-u01-j');
  const s = await setup({ folders: folderOf(rec), health: () => new Promise((resolve) => { setTimeout(() => resolve(false), 5); }), retryMs: 0 });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    const pending = call(s.base, `/run/${rec.id}/`, { headers: TOKEN });
    while (!s.spawned.length) await new Promise((r) => setImmediate(r));
    const { child } = s.spawned[0];
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    lines[45] = 'Authorization: Bearer abc.def.ghi';
    lines[46] = `token=${['da', 'pi', '0123456789abcdef'.repeat(2)].join('')}`;
    lines[47] = `jwt ${['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlLWJ5dGVz'].join('.')}`;
    child.stderr.emit('data', `${lines.slice(0, 30).join('\n')}\n`);
    child.stderr.emit('data', `${lines.slice(30).join('\n')}`);
    child.exitCode = 1;
    child.emit('exit', 1, null);
    const got = await pending;
    assert.equal(got.status, 503);
    assert.equal(got.text, 'this page could not start: the page stopped with exit code 1');
    const owner = s.hosted.stateOf(rec.id, { owner: true });
    assert.deepEqual([owner.state, owner.error], ['failed', 'the page stopped with exit code 1']);
    assert.equal(owner.stderr.length, H.HOSTED_STDERR_LINES);
    assert.equal(owner.stderr[0], 'line 11');
    assert.equal(owner.stderr[39], 'line 50');
    const joined = owner.stderr.join('\n');
    for (const secret of ['abc.def.ghi', 'dapi0123456789abcdef', 'eyJhbGciOiJIUzI1NiJ9']) assert.ok(!joined.includes(secret), secret);
    assert.ok(owner.stderr[35].includes('[redacted]') && owner.stderr[36].includes('[redacted]') && owner.stderr[37].includes('[redacted]'));
    const viewer = s.hosted.stateOf(rec.id, { owner: false });
    assert.deepEqual([viewer.state, viewer.error, Object.hasOwn(viewer, 'stderr')], ['failed', 'the page stopped with exit code 1', false]);
  } finally {
    await s.close();
  }
});

test('a page that never answers /health within the cap fails and is stopped', async () => {
  const rec = record('n01-u01-k');
  const s = await setup({ folders: folderOf(rec), health: async () => false, healthMs: 1000 });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    const got = await call(s.base, `/run/${rec.id}/`, { headers: TOKEN });
    assert.equal(got.status, 503);
    assert.match(got.text, /did not answer \/health within 1 seconds/);
    assert.deepEqual(s.spawned[0].child.kills, ['SIGTERM']);
    assert.equal(s.hosted.stateOf(rec.id).state, 'failed');
  } finally {
    await s.close();
  }
});

test('Inspire stopping kills every page process it started', async () => {
  const recs = [record('n01-u01-l'), record('n01-u02-l')];
  const s = await setup({ folders: Object.assign({}, ...recs.map((r) => folderOf(r))) });
  try {
    s.hosted.setListed(recs.map(entry), { key: 'db' });
    for (const rec of recs) assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
    const target = new EventEmitter();
    target.pid = 4242;
    target.signals = [];
    target.kill = (pid, signal) => target.signals.push([pid, signal]);
    const timer = s.hosted.installLifecycle(target);
    clearInterval(timer);
    target.emit('SIGTERM');
    assert.deepEqual(s.spawned.map((p) => p.child.kills), [['SIGTERM'], ['SIGTERM']]);
    assert.deepEqual(target.signals, [[4242, 'SIGTERM']], 'Inspire still exits on the signal');
    target.emit('exit');
  } finally {
    await s.close();
  }
});

test('the interpreter is the first python3 or python on PATH that imports fastapi and uvicorn, with relative folders read from the cwd', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-python-'));
  try {
    for (const dir of ['sys/bin', 'app/.venv/bin']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    for (const file of ['sys/bin/python3', 'app/.venv/bin/python3', 'app/.venv/bin/python']) fs.writeFileSync(path.join(tmp, file), '');
    const tried = [];
    const venv = path.join(tmp, 'app/.venv/bin/python3');
    const picked = await H.pythonFor(`${path.join(tmp, 'sys/bin')}:.venv/bin`, path.join(tmp, 'app'), async (file) => {
      tried.push(file);
      return file === venv;
    });
    assert.equal(picked, venv);
    assert.deepEqual(tried, [path.join(tmp, 'sys/bin/python3'), venv], 'the system python without fastapi is passed over');
    assert.equal(await H.pythonFor('/nowhere', tmp, async () => true), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the alerts of a page are answered by Inspire from the raw request before any body parser, never by the page process', async () => {
  const rec = record('n01-u01-alerts');
  const s = await setup({ folders: folderOf(rec) });
  const asked = [];
  s.hosted.useAlerts(async (req, held, step, body) => {
    asked.push({ step, body, id: held.record.id, use_case_id: held.use_case_id, session_id: held.session_id, token: req.headers['x-forwarded-access-token'] });
    if (body.name === 'refused') throw Object.assign(new Error('only the person who set up this alert can change it'), { statusCode: 403 });
    return { step, ok: true };
  });
  try {
    s.hosted.setListed([{ ...entry(rec), session_id: '42', use_case_id: 'N01-U01' }], { key: 'db' });
    const json = { ...TOKEN, 'content-type': 'application/json' };
    const listing = await call(s.base, `/run/${rec.id}/api/alerts?page=n01_u01`, { headers: TOKEN });
    assert.deepEqual([listing.status, JSON.parse(listing.text)], [200, { step: 'listing', ok: true }]);
    assert.equal(listing.headers['content-security-policy'], H.hostedCsp(s.base, rec.id), 'an alert answer carries the page policy like every hosted answer');
    assert.equal(listing.headers['x-content-type-options'], 'nosniff');
    assert.equal(listing.headers['cache-control'], 'no-store');
    const saved = await call(s.base, `/run/${rec.id}/api/alerts/save`, { method: 'POST', headers: json, body: JSON.stringify({ page: 'n01_u01', name: 'x' }) });
    assert.deepEqual([saved.status, JSON.parse(saved.text)], [200, { step: 'save', ok: true }]);
    const refused = await call(s.base, `/run/${rec.id}/api/alerts/pause`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'refused' }) });
    assert.deepEqual([refused.status, JSON.parse(refused.text)], [403, { error: 'only the person who set up this alert can change it' }]);
    const broken = await call(s.base, `/run/${rec.id}/api/alerts/delete`, { method: 'POST', headers: json, body: '{not json' });
    assert.deepEqual([broken.status, JSON.parse(broken.text)], [400, { error: 'send the request as JSON' }]);
    const list = await call(s.base, `/run/${rec.id}/api/alerts/delete`, { method: 'POST', headers: json, body: '[1]' });
    assert.deepEqual([list.status, JSON.parse(list.text)], [400, { error: 'send a JSON object' }]);
    const large = await call(s.base, `/run/${rec.id}/api/alerts/save`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'a'.repeat(1100000) }) });
    assert.equal(large.status, 413);
    const other = await call(s.base, `/run/${rec.id}/api/alerts?page=other`, { headers: TOKEN });
    assert.deepEqual([other.status, JSON.parse(other.text)], [404, { error: "the App has no page 'other'" }]);
    const stranger = await call(s.base, `/run/${rec.id}/api/alerts/save`, { method: 'POST', headers: json, body: JSON.stringify({ page: 'n02_u01' }) });
    assert.equal(stranger.status, 404);
    const noToken = await call(s.base, `/run/${rec.id}/api/alerts?page=n01_u01`, { headers: { 'x-forwarded-email': OWNER } });
    assert.deepEqual([noToken.status, noToken.text], [401, H.HOSTED_NO_TOKEN]);
    assert.deepEqual(asked.map((a) => [a.step, a.id, a.session_id, a.use_case_id, a.token]),
      [['listing', rec.id, '42', 'N01-U01', 'user-token'], ['save', rec.id, '42', 'N01-U01', 'user-token'], ['pause', rec.id, '42', 'N01-U01', 'user-token']]);
    assert.deepEqual(asked[1].body, { page: 'n01_u01', name: 'x' });
    assert.equal(s.spawned.length, 0, 'the page process was never started for its alerts');
    assert.deepEqual(s.up.seen, []);
    const info = await call(s.base, `/run/${rec.id}/api/app`, { headers: TOKEN });
    assert.equal(info.status, 200);
    assert.deepEqual(JSON.parse(info.text), { ok: true, url: '/api/app', alerting: { on: true, reason: '' }, options: { alerts: true } },
      'the page says its alerts are on, since Inspire keeps them');
    assert.equal(Number(info.headers['content-length']), Buffer.byteLength(info.text));
    const other2 = await call(s.base, `/run/${rec.id}/api/records`, { headers: TOKEN });
    assert.deepEqual(JSON.parse(other2.text), { ok: true, url: '/api/records' }, 'every other answer passes through untouched');
  } finally {
    await s.close();
  }
});

test('without an alerts handler the alert paths and the app info reach the page untouched', async () => {
  const rec = record('n01-u01-plain');
  const s = await setup({ folders: folderOf(rec) });
  try {
    s.hosted.setListed([entry(rec)], { key: 'db' });
    const got = await call(s.base, `/run/${rec.id}/api/alerts?page=n01_u01`, { headers: TOKEN });
    assert.deepEqual(JSON.parse(got.text), { ok: true, url: '/api/alerts?page=n01_u01' });
    const info = await call(s.base, `/run/${rec.id}/api/app`, { headers: TOKEN });
    assert.deepEqual(JSON.parse(info.text), { ok: true, url: '/api/app' });
    assert.deepEqual(Object.keys(H.HOSTED_ALERT_ROUTES), ['GET /api/alerts', 'POST /api/alerts/preview', 'POST /api/alerts/save', 'POST /api/alerts/pause',
      'POST /api/alerts/delete']);
  } finally {
    await s.close();
  }
});

test('stderr lines lose anything that looks like a token', () => {
  assert.equal(H.redactSecrets('GET /api x-forwarded-access-token: Bearer abc'), 'GET /api x-forwarded-access-token: [redacted]');
  assert.equal(H.redactSecrets('client_secret="s3cr3t" next'), 'client_secret="[redacted]" next');
  assert.equal(H.redactSecrets(`key ${'A'.repeat(48)} end`), 'key [redacted] end');
  assert.equal(H.redactSecrets('INFO: Uvicorn running on http://127.0.0.1:8123'), 'INFO: Uvicorn running on http://127.0.0.1:8123');
});

test('the policy of a page Inside Inspire allows only its own /run/<id>/ path, never inline script or eval, and locks down when the origin is unclear', () => {
  const origin = 'https://inspire-ai-111122223333444.example.com';
  assert.equal(H.hostedCsp(origin, 'n01-u01-42'), [
    "default-src 'none'",
    `script-src ${origin}/run/n01-u01-42/assets/`,
    `style-src ${origin}/run/n01-u01-42/assets/`,
    `img-src ${origin}/run/n01-u01-42/ data:`,
    `font-src ${origin}/run/n01-u01-42/`,
    `connect-src ${origin}/run/n01-u01-42/`,
    `form-action ${origin}/run/n01-u01-42/`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join('; '));
  assert.ok(!/unsafe-inline|unsafe-eval|blob:|\*/.test(H.hostedCsp(origin, 'n01-u01-42')));
  assert.equal(H.pageOrigin({ headers: { 'x-forwarded-host': 'Inspire-AI.Example.com', host: '127.0.0.1:8000' }, protocol: 'http' }), 'https://inspire-ai.example.com',
    'behind the Apps proxy the page origin is the host the browser asked for, over https');
  assert.equal(H.pageOrigin({ headers: { host: '127.0.0.1:8000' }, protocol: 'http' }), 'http://127.0.0.1:8000');
  for (const host of ["evil.example.com; script-src *", 'a b', 'x/y', '']) {
    assert.equal(H.hostedCsp(H.pageOrigin({ headers: { 'x-forwarded-host': host, host } }), 'n01-u01-42'), H.HOSTED_LOCKED_CSP, JSON.stringify(host));
  }
  assert.equal(H.hostedCsp(origin, 'Not An Id'), H.HOSTED_LOCKED_CSP);
  assert.equal(H.HOSTED_LOCKED_CSP, "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  const doc = (method, path, dest = '') => H.documentLoad({ method, headers: dest ? { 'sec-fetch-dest': dest } : {} }, path);
  assert.deepEqual([doc('GET', '/'), doc('GET', '/index.html'), doc('GET', '/x', 'iframe'), doc('HEAD', '/'), doc('GET', '/assets/app.js'),
    doc('GET', '/api/app'), doc('POST', '/'), doc('GET', '/api/app', 'empty')], [true, true, true, true, false, false, false, false]);
});

test('with no forwarded token the viewer gate answers 401 before the workspace token check or anything else runs, and the server mounts it first', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-gate-'));
  const hosted = H.createHostedRun({ files: () => ({ list: async () => [], read: async () => Buffer.from('') }), tmpRoot: tmp });
  const reached = [];
  const app = express();
  app.all('/run/:id/{*rest}', hosted.viewerGate, (req, res) => { reached.push(req.url); res.status(500).type('text/plain').send('the workspace is not set up'); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const url of ['/run/n01-u01-a/', '/run/BAD_ID/x', '/run/n01-u01-a/static/%2e%2e/x']) {
      const got = await call(base, url);
      assert.deepEqual([got.status, got.text], [401, H.HOSTED_NO_TOKEN], url);
      assert.ok(got.headers['content-security-policy'].startsWith("default-src 'none'"), url);
    }
    assert.deepEqual(reached, [], 'nothing after the gate ran');
    assert.equal((await call(base, '/run/n01-u01-a/', { headers: TOKEN })).status, 500, 'with a token the request goes on to the next check');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /app\.all\('\/run\/:id\/\{\*rest\}', hostedRun\.viewerGate, \(req, res, next\) => requireToken\(req, res, next\), hostedRun\.proxy\);/);
  assert.match(source, /app\.get\('\/run\/:id', hostedRun\.redirect\);/);
});

test('every page document load reads the live record again, so an uninstalled page is refused at once with the reason', async () => {
  const rec = record('n01-u01-m');
  const s = await setup({ folders: folderOf(rec) });
  const live = { entries: [entry(rec)], reads: 0, fail: '' };
  s.hosted.useReader(async () => {
    live.reads += 1;
    if (live.fail) throw new Error(live.fail);
    return { entries: live.entries, ctx: { key: 'db' } };
  });
  try {
    assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
    assert.equal(live.reads, 1);
    for (const url of ['/assets/app.js', '/api/app']) assert.equal((await call(s.base, `/run/${rec.id}${url}`, { headers: TOKEN })).status, 200);
    assert.equal(live.reads, 1, 'a script or API call within the minute uses the record it just read');
    assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
    assert.equal(live.reads, 2, 'a second document load reads it again');
    assert.equal((await call(s.base, `/run/${rec.id}/x`, { headers: { ...TOKEN, 'sec-fetch-dest': 'iframe' } })).status, 200);
    assert.equal(live.reads, 3, 'a frame load is a document load');
    live.entries = [];
    const gone = await call(s.base, `/run/${rec.id}/`, { headers: TOKEN });
    assert.deepEqual([gone.status, gone.text], [404, H.HOSTED_GONE]);
    assert.equal(gone.headers['content-security-policy'], H.hostedCsp(s.base, rec.id));
    assert.deepEqual(s.spawned[0].child.kills, ['SIGTERM'], 'the page process stops');
    assert.equal(fs.existsSync(path.join(s.tmp, rec.id)), false, 'and its local copy is deleted');
    const after = await call(s.base, `/run/${rec.id}/api/app`, { headers: TOKEN });
    assert.equal(after.status, 404, 'its API is gone too');
  } finally {
    await s.close();
  }
});

test('a document load that cannot read the live record is refused, never served from memory', async () => {
  const rec = record('n01-u01-n');
  const s = await setup({ folders: folderOf(rec) });
  const live = { fail: '' };
  s.hosted.useReader(async () => {
    if (live.fail) throw new Error(live.fail);
    return { entries: [entry(rec)], ctx: { key: 'db' } };
  });
  try {
    assert.equal((await call(s.base, `/run/${rec.id}/`, { headers: TOKEN })).status, 200);
    live.fail = 'the SQL warehouse is stopped';
    const doc = await call(s.base, `/run/${rec.id}/`, { headers: TOKEN });
    assert.deepEqual([doc.status, doc.text], [502,
      'Inspire could not check that this page is still Inside Inspire, so it does not show it: the SQL warehouse is stopped']);
    assert.equal((await call(s.base, `/run/${rec.id}/api/app`, { headers: TOKEN })).status, 200, 'calls of a page already open keep working for the minute');
  } finally {
    await s.close();
  }
});
