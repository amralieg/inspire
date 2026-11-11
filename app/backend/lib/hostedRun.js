const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const childProcess = require('child_process');
const { redactSecrets: redactAny } = require('./redact');
const { IMPLEMENT_APP_HOSTED_ID_RE: HOSTED_ID_RE } = require('./inspireImplement');
const { forwardedTokenOf } = require('./requestPerson');
const { parseExactJson } = require('./exactJson');
const HOSTED_MAX_CHILDREN = 3;
const HOSTED_IDLE_MS = 15 * 60 * 1000;
const HOSTED_HEALTH_MS = 60 * 1000;
const HOSTED_HEALTH_POLL_MS = 250;
const HOSTED_STALE_MS = 60 * 1000;
const HOSTED_RETRY_MS = 30 * 1000;
const HOSTED_SWEEP_MS = 60 * 1000;
const HOSTED_KILL_GRACE_MS = 5000;
const HOSTED_STDERR_LINES = 40;
const HOSTED_MAX_FILES = 2000;
const HOSTED_MAX_BYTES = 200 * 1024 * 1024;
const HOSTED_FORWARD_HEADERS = ['x-forwarded-access-token', 'x-forwarded-email', 'x-forwarded-user', 'x-forwarded-preferred-username',
  'content-type', 'accept', 'content-length'];
const HOSTED_CHILD_ENV = ['PATH', 'HOME', 'LANG', 'DATABRICKS_HOST', 'DATABRICKS_WAREHOUSE_ID'];
const HOSTED_LOCKED_CSP = "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const HOSTED_HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/;
const HOSTED_GONE = 'this page is no longer Inside Inspire: it was uninstalled or moved to an App of its own, so Inspire stopped it; '
  + 'open the Run tab to see what is deployed';
const HOSTED_DROPPED_RESPONSE_HEADERS = ['connection', 'keep-alive', 'transfer-encoding', 'set-cookie', 'content-security-policy',
  'x-content-type-options', 'x-frame-options'];
const HOSTED_NO_TOKEN = 'Inspire needs permission to act as you to show this page; a workspace admin turns on user authorization for Apps, '
  + 'then reopen Inspire';
const HOSTED_PYTHON_MODULES = ['fastapi', 'uvicorn', 'requests'];
const HOSTED_APP_INFO = '/api/app';
const HOSTED_ALERT_ROUTES = {
  'GET /api/alerts': 'listing', 'POST /api/alerts/preview': 'preview', 'POST /api/alerts/save': 'save', 'POST /api/alerts/pause': 'pause',
  'POST /api/alerts/delete': 'delete',
};
const HOSTED_ALERT_BODY_BYTES = 1024 * 1024;
const HOSTED_DECISION_ROUTES = {
  'POST /api/records/act': 'records/act', 'POST /api/records/undo': 'records/undo',
  'POST /api/settings/save': 'settings/save', 'POST /api/money/assumption': 'money/assumption', 'POST /api/money/rule': 'money/rule',
  'POST /api/feedback': 'feedback',
};
const HOSTED_DECISION_SCRIPT = ['import json, sys', 'sys.path.insert(0, sys.argv[1])', 'import shell_core',
  'if hasattr(shell_core, "cli"):', '    sys.exit(shell_core.cli())', 'print(json.dumps({"status": 409, "body": {"error": sys.argv[2]}}))'].join('\n');
const HOSTED_DECISION_VERSION = 1;
const HOSTED_DECISION_TIMEOUT_MS = 120 * 1000;
const HOSTED_DECISION_MAX_BYTES = 8 * 1024 * 1024;
const HOSTED_DECISION_TEXT = { stopped: 'Inspire stopped recording the decision', step: 'the decision step', purpose: 'to record the decision' };
const HOSTED_DECISION_REBUILD = 'build the use case again with Vibe/Add/Remove Features on Inspire\'s Build page so its page carries the current App shell';
const HOSTED_TMP_ROOT = path.join(os.tmpdir(), 'inspire_hosted');
const HOSTED_LISTENING_RE = /Uvicorn running on https?:\/\/127\.0\.0\.1:(\d+)/;
const HOSTED_SECRET_PATTERNS = [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g];

const redactSecrets = (text) => redactAny(text, HOSTED_SECRET_PATTERNS);

function absoluteDirs(pathValue, cwd) {
  const dirs = [];
  for (const dir of String(pathValue || '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.resolve(cwd, dir);
    if (!dirs.includes(full)) dirs.push(full);
  }
  return dirs;
}

async function pythonFor(pathValue, cwd, canImport = defaultCanImport) {
  for (const dir of absoluteDirs(pathValue, cwd)) {
    for (const name of ['python3', 'python']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file) && await canImport(file)) return file;
    }
  }
  return '';
}

function defaultCanImport(file) {
  return new Promise((resolve) => {
    childProcess.execFile(file, ['-c', `import ${HOSTED_PYTHON_MODULES.join(', ')}`], { timeout: 30000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } },
      (err) => resolve(!err));
  });
}

function childEnv(parentEnv, { python, home, warehouseId, cwd }) {
  const dirs = absoluteDirs(parentEnv.PATH, cwd);
  const first = python ? path.dirname(python) : '';
  const env = {
    PATH: [first, ...dirs.filter((d) => d !== first)].filter(Boolean).join(path.delimiter),
    HOME: home,
    LANG: String(parentEnv.LANG || 'C.UTF-8'),
    DATABRICKS_HOST: String(parentEnv.DATABRICKS_HOST || ''),
    DATABRICKS_WAREHOUSE_ID: String(warehouseId || ''),
  };
  return Object.fromEntries(HOSTED_CHILD_ENV.map((name) => [name, env[name]]));
}

function pageOrigin(req) {
  const headers = (req && req.headers) || {};
  const forwarded = String(headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded) return HOSTED_HOST_RE.test(forwarded) ? `https://${forwarded}` : '';
  const host = String(headers.host || '').trim().toLowerCase();
  if (!HOSTED_HOST_RE.test(host)) return '';
  return `${req.protocol === 'https' ? 'https' : 'http'}://${host}`;
}

function hostedCsp(origin, id) {
  if (!HOSTED_ID_RE.test(String(id || ''))) return HOSTED_LOCKED_CSP;
  return pageCsp(origin, `/run/${id}/`);
}

function pageCsp(origin, folder) {
  if (!origin) return HOSTED_LOCKED_CSP;
  const root = `${origin}${folder}`;
  return pagePolicy(root, `${root}assets/`);
}

function sameOriginCsp() {
  return pagePolicy("'self'", "'self'");
}

function pagePolicy(root, assets) {
  return [
    "default-src 'none'",
    `script-src ${assets}`,
    `style-src ${assets}`,
    `img-src ${root} data:`,
    `font-src ${root}`,
    `connect-src ${root}`,
    `form-action ${root}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

function documentLoad(req, path) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
  return path === '/' || /\.html?$/i.test(path) || ['document', 'iframe', 'frame'].includes(dest);
}

function forwardedHeaders(headers) {
  const out = {};
  for (const name of HOSTED_FORWARD_HEADERS) {
    const value = headers[name];
    if (value != null && value !== '') out[name] = value;
  }
  return out;
}

function workspaceKey(value) {
  return String(value || '').replace(/\/+$/, '').replace(/^\/Workspace(?=\/)/, '');
}

function relativeSource(root, full) {
  const base = workspaceKey(root);
  const item = workspaceKey(full);
  if (!item.startsWith(`${base}/`)) throw new Error(`${full} is outside the page folder ${root}`);
  const rel = item.slice(base.length + 1);
  const parts = rel.split('/');
  if (!rel || rel.includes('\\') || rel.includes('\0') || parts.some((p) => !p || p === '.' || p === '..')) {
    throw new Error(`${full} is not a plain path inside the page folder ${root}`);
  }
  return rel;
}

function safeLocalPath(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error(`${rel} would leave the local copy of the page`);
  return target;
}

function workspaceFiles(dbFetch) {
  return (host, token) => ({
    async list(folder) {
      const resp = await dbFetch(host, token, `/api/2.0/workspace/list?path=${encodeURIComponent(folder)}`);
      if (!resp.ok) throw new Error(`the page folder ${folder} could not be listed (${resp.status}): ${String(await resp.text()).slice(0, 300)}`);
      const data = await resp.json();
      return Array.isArray(data.objects) ? data.objects : [];
    },
    async read(file) {
      const resp = await dbFetch(host, token, `/api/2.0/workspace/export?path=${encodeURIComponent(file)}&direct_download=true`);
      if (!resp.ok) throw new Error(`${file} could not be read (${resp.status}): ${String(await resp.text()).slice(0, 300)}`);
      return Buffer.from(await resp.arrayBuffer());
    },
  });
}

function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

function stepError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function runPythonJson(spawn, python, { script, args = [], cwd, env, input, timeoutMs, maxBytes, text }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-B', '-E', '-s', '-c', script, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let size = 0;
    let done = false;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, stepError(504, `${text.stopped} after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill('SIGKILL');
        finish(reject, stepError(502, `${text.step} answered with more text than Inspire reads`));
      } else {
        out += chunk;
      }
    });
    child.stderr.on('data', (chunk) => { if (err.length < 4000) err += chunk; });
    child.on('error', (e) => finish(reject, stepError(503, `Inspire could not start Python ${text.purpose}: ${e.message}`)));
    child.on('close', (code) => {
      let parsed;
      try {
        parsed = parseExactJson(out);
      } catch {
        finish(reject, stepError(502, `${text.step} ended without an answer (exit ${code}): ${redactSecrets(err).trim().slice(-600)}`));
        return;
      }
      finish(resolve, parsed);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function createHostedRun(options = {}) {
  const {
    spawn = childProcess.spawn,
    pickPython = () => pythonFor(process.env.PATH, process.cwd()),
    files = null,
    tmpRoot = HOSTED_TMP_ROOT,
    env = process.env,
    cwd = process.cwd(),
    now = Date.now,
    checkHealth = healthy,
    pause = wait,
    maxChildren = HOSTED_MAX_CHILDREN,
    idleMs = HOSTED_IDLE_MS,
    healthMs = HOSTED_HEALTH_MS,
    pollMs = HOSTED_HEALTH_POLL_MS,
    staleMs = HOSTED_STALE_MS,
    retryMs = HOSTED_RETRY_MS,
    killGraceMs = HOSTED_KILL_GRACE_MS,
    decisionMs = HOSTED_DECISION_TIMEOUT_MS,
  } = options;
  const listed = new Map();
  const runs = new Map();
  let reader = null;
  let alerts = null;
  let decisions = null;
  let python = null;

  const idDir = (id) => safeLocalPath(tmpRoot, id);
  const versionDir = (record) => path.join(idDir(record.id), `v${record.version}`);
  const syncedMark = (record) => path.join(idDir(record.id), `v${record.version}.synced`);

  function useReader(fn) {
    reader = fn;
  }

  function useAlerts(fn) {
    alerts = fn;
  }

  function useDecisions(fn) {
    decisions = fn;
  }

  function setListed(entries, ctx = {}) {
    const key = String(ctx.key || '');
    const fresh = new Map();
    for (const entry of entries || []) {
      const record = entry && entry.hosted;
      if (!record || !HOSTED_ID_RE.test(String(record.id || ''))) continue;
      fresh.set(record.id, { record, owners: (entry.owners || []).map((o) => String(o).toLowerCase()), ctx, listedAt: now(),
        session_id: String(entry.session_id || ''), use_case_id: String(entry.use_case_id || '') });
    }
    for (const [id, held] of listed) {
      if (String(held.ctx.key || '') === key && !fresh.has(id)) forget(id, 'it is no longer Inside Inspire');
    }
    for (const [id, entry] of fresh) {
      listed.set(id, entry);
      const run = runs.get(id);
      if (run && run.version !== entry.record.version && run.child) stop(id, `v${entry.record.version} was published`);
    }
    return fresh;
  }

  function forget(id, reason) {
    stop(id, reason);
    runs.delete(id);
    listed.delete(id);
    fs.rmSync(idDir(id), { recursive: true, force: true });
  }

  function alive() {
    return [...runs.values()].filter((r) => r.child && (r.state === 'starting' || r.state === 'ready'));
  }

  function stop(id, reason) {
    const run = runs.get(id);
    if (!run || !run.child) return false;
    const { child } = run;
    run.state = 'stopped';
    run.reason = reason;
    run.child = null;
    run.port = null;
    run.stopping = true;
    try {
      child.kill('SIGTERM');
    } catch {
      return true;
    }
    const timer = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }, killGraceMs);
    if (timer.unref) timer.unref();
    return true;
  }

  function stopAll(reason = 'Inspire stopped') {
    for (const id of runs.keys()) stop(id, reason);
  }

  function makeRoom(id) {
    const others = alive().filter((r) => r.id !== id).sort((a, b) => a.lastUsed - b.lastUsed);
    while (others.length && others.length + 1 > maxChildren) {
      const oldest = others.shift();
      stop(oldest.id, 'it was stopped to make room for another page; open it again to start it');
    }
  }

  function sweep() {
    const at = now();
    for (const run of alive()) {
      if (run.state === 'ready' && at - run.lastUsed >= idleMs) stop(run.id, 'it was stopped after 15 minutes with no visits; open it again to start it');
    }
  }

  async function syncSource(record, ws) {
    const dir = versionDir(record);
    if (fs.existsSync(syncedMark(record)) && fs.existsSync(dir)) return dir;
    const stage = path.join(idDir(record.id), `.v${record.version}.partial`);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    try {
      await copyFolder(record, ws, stage);
    } catch (err) {
      fs.rmSync(stage, { recursive: true, force: true });
      throw err;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(stage, dir);
    fs.writeFileSync(syncedMark(record), `${record.source}\n`);
    return dir;
  }

  async function copyFolder(record, ws, stage) {
    const queue = [record.source];
    let count = 0;
    let bytes = 0;
    while (queue.length) {
      const folder = queue.shift();
      for (const item of await ws.list(folder)) {
        const full = String(item.path || '');
        const rel = relativeSource(record.source, full);
        if (item.object_type === 'DIRECTORY') {
          queue.push(full);
          continue;
        }
        if (item.object_type !== 'FILE') throw new Error(`${rel} is a ${String(item.object_type || 'workspace object').toLowerCase()}, not a file`);
        count += 1;
        if (count > HOSTED_MAX_FILES) throw new Error(`the page folder holds more than ${HOSTED_MAX_FILES} files`);
        const target = safeLocalPath(stage, rel);
        const body = await ws.read(full);
        bytes += body.length;
        if (bytes > HOSTED_MAX_BYTES) throw new Error('the page folder holds more than 200 MB');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
      }
    }
    if (!fs.existsSync(path.join(stage, 'app.py'))) throw new Error(`the page folder ${record.source} has no app.py`);
  }

  function dropOtherVersions(record) {
    const root = idDir(record.id);
    if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root)) {
      if (name === `v${record.version}` || name === `v${record.version}.synced` || name === 'home') continue;
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }

  async function pageRuntime(record, ws) {
    const dir = await syncSource(record, ws);
    if (python == null) python = await pickPython();
    if (!python) throw new Error(`Inspire found no Python with ${HOSTED_PYTHON_MODULES.join(', ')} to run the page`);
    const home = path.join(idDir(record.id), 'home');
    fs.mkdirSync(home, { recursive: true });
    return { dir, python, env: childEnv(env, { python, home, warehouseId: record.warehouse_id, cwd }) };
  }

  async function startRun(run, record, ws) {
    const { dir, env: pageEnv } = await pageRuntime(record, ws);
    const child = spawn(python, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '0'], {
      cwd: dir,
      env: pageEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    run.child = child;
    const until = now() + healthMs;
    let heard;
    const listening = new Promise((resolve, reject) => { heard = { resolve, reject }; });
    const silence = setTimeout(() => heard.reject(new Error('silent')), healthMs);
    if (silence.unref) silence.unref();
    let partial = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const lines = (partial + String(chunk)).split(/\r?\n/);
        partial = lines.pop();
        for (const line of lines) {
          const said = HOSTED_LISTENING_RE.exec(line);
          if (said) heard.resolve(Number(said[1]));
        }
        run.stderr.push(...lines.map(redactSecrets));
        if (run.stderr.length > HOSTED_STDERR_LINES) run.stderr.splice(0, run.stderr.length - HOSTED_STDERR_LINES);
      });
    }
    child.on('error', (err) => {
      if (run.child !== child) return;
      run.child = null;
      fail(run, `the page could not start: ${err.message}`);
      heard.reject(new Error(run.error));
    });
    child.on('exit', (code, signal) => {
      if (partial) run.stderr.push(redactSecrets(partial));
      if (run.stderr.length > HOSTED_STDERR_LINES) run.stderr.splice(0, run.stderr.length - HOSTED_STDERR_LINES);
      if (run.child !== child) return;
      run.child = null;
      run.port = null;
      fail(run, `the page stopped${code != null ? ` with exit code ${code}` : ''}${signal ? ` on ${signal}` : ''}`);
      heard.reject(new Error(run.error));
    });
    let port;
    try {
      port = await listening;
    } catch (err) {
      if (run.child !== child) throw new Error(run.error || 'the page stopped before it was ready');
      stop(run.id, 'it did not answer in time');
      fail(run, `the page did not say which port it listens on within ${Math.round(healthMs / 1000)} seconds`);
      throw new Error(run.error);
    } finally {
      clearTimeout(silence);
    }
    if (!(port > 0)) {
      stop(run.id, 'it did not say which port it listens on');
      fail(run, 'the page did not say which port it listens on: Inside Inspire needs uvicorn 0.15 or newer');
      throw new Error(run.error);
    }
    if (run.child === child) run.port = port;
    while (now() < until) {
      if (run.child !== child) throw new Error(run.error || 'the page stopped before it was ready');
      if (await checkHealth(run.port)) {
        run.state = 'ready';
        run.readyAt = now();
        dropOtherVersions(record);
        return run;
      }
      await pause(pollMs);
    }
    stop(run.id, 'it did not answer in time');
    fail(run, `the page did not answer /health within ${Math.round(healthMs / 1000)} seconds`);
    throw new Error(run.error);
  }

  function fail(run, message) {
    run.state = 'failed';
    run.error = message;
    run.failedAt = now();
  }

  async function ensure(entry, ws) {
    const { record } = entry;
    let run = runs.get(record.id);
    if (run && run.version !== record.version) {
      stop(record.id, `v${record.version} was published`);
      run = null;
    }
    if (run && run.child && run.state === 'ready') return run;
    if (run && run.child && run.state === 'starting') return run.ready;
    if (run && run.state === 'failed' && now() - run.failedAt < retryMs) throw new Error(run.error);
    makeRoom(record.id);
    run = { id: record.id, version: record.version, state: 'starting', reason: '', error: '', stderr: [], lastUsed: now(), child: null, port: null };
    runs.set(record.id, run);
    run.ready = startRun(run, record, ws).catch((err) => {
      if (run.state !== 'failed') fail(run, err.message || String(err));
      throw new Error(run.error);
    });
    return run.ready;
  }

  function stateOf(id, { owner = false } = {}) {
    const run = runs.get(id);
    if (!run) return { state: 'stopped', reason: '', error: '' };
    return {
      state: run.state,
      reason: run.state === 'stopped' ? run.reason || '' : '',
      error: run.state === 'failed' ? run.error : '',
      ...(owner && run.state === 'failed' ? { stderr: [...run.stderr] } : {}),
    };
  }

  async function refresh(req, ctx) {
    if (!reader) return false;
    const got = await reader(req, ctx);
    if (got) setListed(got.entries, got.ctx);
    return true;
  }

  function guard(res, req, id) {
    res.setHeader('Content-Security-Policy', hostedCsp(pageOrigin(req), id));
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  function plain(res, status, message) {
    res.status(status).type('text/plain').send(message);
  }

  function sendJson(res, status, data) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(data);
  }

  function readBody(req) {
    if (req.readableEnded) {
      const parsed = req.body === undefined ? {} : req.body;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Promise.resolve(parsed)
        : Promise.reject(Object.assign(new Error('send a JSON object'), { statusCode: 400 }));
    }
    return new Promise((resolve, reject) => {
      let text = '';
      let size = 0;
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        size += Buffer.byteLength(chunk);
        if (size <= HOSTED_ALERT_BODY_BYTES) text += chunk;
      });
      req.on('end', () => {
        if (size > HOSTED_ALERT_BODY_BYTES) {
          reject(Object.assign(new Error('the request is too large'), { statusCode: 413 }));
          return;
        }
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          reject(Object.assign(new Error('send the request as JSON'), { statusCode: 400 }));
          return;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) reject(Object.assign(new Error('send a JSON object'), { statusCode: 400 }));
        else resolve(data);
      });
      req.on('error', reject);
    });
  }

  async function answerAlerts(req, res, entry, step, rest) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const asked = step === 'listing' ? new URLSearchParams(rest.split('?')[1] || '').get('page') : body.page;
      if (asked != null && String(asked) !== String(entry.record.page)) return sendJson(res, 404, { error: `the App has no page '${asked}'` });
      return sendJson(res, 200, await alerts(req, entry, step, body));
    } catch (err) {
      return sendJson(res, Number.isInteger(err.statusCode) ? err.statusCode : 500, { error: err.message || String(err) });
    }
  }

  async function answerDecisions(req, res, entry, route) {
    try {
      const body = await readBody(req);
      if (!files) throw stepError(500, 'Inspire cannot read the page files');
      const runtime = await pageRuntime(entry.record, files(req.dbHost, req.dbToken));
      const asked = await decisions(req, entry);
      const request = {
        v: HOSTED_DECISION_VERSION, route, root: runtime.dir, host: req.dbHost, warehouse: entry.record.warehouse_id,
        result_table: asked.result_table, writer: asked.writer, headers: forwardedHeaders(req.headers), body,
      };
      const answer = await runPythonJson(spawn, runtime.python, {
        script: HOSTED_DECISION_SCRIPT, args: [runtime.dir, `this page was built before Inspire recorded decisions inside Inspire; ${HOSTED_DECISION_REBUILD}`],
        cwd: runtime.dir, env: runtime.env, input: JSON.stringify(request),
        timeoutMs: decisionMs, maxBytes: HOSTED_DECISION_MAX_BYTES, text: HOSTED_DECISION_TEXT,
      });
      if (!answer || typeof answer !== 'object' || !Number.isInteger(answer.status) || !answer.body || typeof answer.body !== 'object') {
        throw stepError(502, `${HOSTED_DECISION_TEXT.step} gave no answer Inspire can read; ${HOSTED_DECISION_REBUILD}`);
      }
      return sendJson(res, answer.status, answer.body);
    } catch (err) {
      return sendJson(res, Number.isInteger(err.statusCode) ? err.statusCode : 500, { error: err.message || String(err) });
    }
  }

  function alertingOn(text) {
    try {
      const info = JSON.parse(text);
      if (!info || typeof info !== 'object' || Array.isArray(info)) return text;
      return JSON.stringify({ ...info, alerting: { on: true, reason: '' }, options: { ...(info.options || {}), alerts: true } });
    } catch {
      return text;
    }
  }

  function forward(req, res, run, rest, id) {
    const patched = Boolean(alerts) && req.method === 'GET' && rest.split('?')[0] === HOSTED_APP_INFO;
    const secured = { 'Content-Security-Policy': hostedCsp(pageOrigin(req), id), 'X-Content-Type-Options': 'nosniff' };
    const upstream = http.request({
      host: '127.0.0.1', port: run.port, method: req.method, path: rest,
      headers: { ...forwardedHeaders(req.headers), ...(patched || !req.headers['accept-encoding'] ? {} : { 'accept-encoding': req.headers['accept-encoding'] }), host: `127.0.0.1:${run.port}` },
    }, (answer) => {
      const headers = {};
      for (const [name, value] of Object.entries(answer.headers)) if (!HOSTED_DROPPED_RESPONSE_HEADERS.includes(name)) headers[name] = value;
      if (patched && answer.statusCode === 200) {
        let text = '';
        answer.setEncoding('utf8');
        answer.on('data', (chunk) => { text += chunk; });
        answer.on('end', () => {
          const out = alertingOn(text);
          res.writeHead(200, { ...headers, 'content-length': Buffer.byteLength(out), ...secured });
          res.end(out);
        });
        return;
      }
      res.writeHead(answer.statusCode || 502, { ...headers, ...secured });
      answer.pipe(res);
    });
    upstream.on('error', (err) => {
      if (!res.headersSent) plain(res, 502, `the page did not answer: ${err.message}`);
      else res.destroy(err);
    });
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  }

  async function proxy(req, res) {
    const id = String(req.params.id || '');
    guard(res, req, id);
    if (!forwardedTokenOf(req)) return plain(res, 401, HOSTED_NO_TOKEN);
    if (!HOSTED_ID_RE.test(id)) return plain(res, 404, 'there is no page with that id Inside Inspire');
    const prefix = `/run/${id}`;
    const url = String(req.originalUrl || req.url || '');
    const pathOnly = url.split('?')[0];
    if (pathOnly === prefix) return redirect(req, res);
    const rest = url.startsWith(prefix) ? url.slice(prefix.length) || '/' : '/';
    if (!rest.startsWith('/') || rest.split('?')[0].split('/').some((part) => part === '..' || /%2e%2e/i.test(part))) {
      return plain(res, 400, 'that path is not inside the page');
    }
    const document = documentLoad(req, rest.split('?')[0]);
    const before = listed.get(id);
    let entry = before;
    if (document || !entry || now() - entry.listedAt > staleMs) {
      try {
        await refresh(req, entry ? entry.ctx : null);
      } catch (err) {
        if (document || !entry) return plain(res, 502, `Inspire could not check that this page is still Inside Inspire, so it does not show it: ${err.message}`);
      }
      entry = listed.get(id);
    }
    if (!entry && before) return plain(res, 404, HOSTED_GONE);
    if (!entry) return plain(res, 404, `Inspire has no page ${id} Inside Inspire; open it from the Run tab`);
    const step = alerts ? HOSTED_ALERT_ROUTES[`${req.method} ${rest.split('?')[0]}`] : null;
    if (step) return answerAlerts(req, res, entry, step, rest);
    const decision = decisions ? HOSTED_DECISION_ROUTES[`${req.method} ${rest.split('?')[0]}`] : null;
    if (decision) return answerDecisions(req, res, entry, decision);
    if (!files) return plain(res, 500, 'Inspire cannot read the page files');
    let run;
    try {
      run = await ensure(entry, files(req.dbHost, req.dbToken));
    } catch (err) {
      return plain(res, 503, `this page could not start: ${err.message}`);
    }
    run.lastUsed = now();
    return forward(req, res, run, rest, id);
  }

  function viewerGate(req, res, next) {
    if (forwardedTokenOf(req)) return next();
    guard(res, req, String(req.params.id || ''));
    return plain(res, 401, HOSTED_NO_TOKEN);
  }

  function redirect(req, res) {
    const id = String(req.params.id || '');
    guard(res, req, id);
    if (!forwardedTokenOf(req)) return plain(res, 401, HOSTED_NO_TOKEN);
    if (!HOSTED_ID_RE.test(id)) return plain(res, 404, 'there is no page with that id Inside Inspire');
    const query = String(req.originalUrl || '').split('?')[1];
    return res.redirect(301, `/run/${id}/${query ? `?${query}` : ''}`);
  }

  function installLifecycle(target = process) {
    target.on('exit', () => stopAll());
    for (const signal of ['SIGTERM', 'SIGINT']) {
      target.once(signal, () => {
        stopAll();
        target.kill(target.pid, signal);
      });
    }
    const timer = setInterval(sweep, HOSTED_SWEEP_MS);
    if (timer.unref) timer.unref();
    return timer;
  }

  return { listed, runs, useReader, useAlerts, useDecisions, setListed, forget, stop, stopAll, sweep, ensure, stateOf, refresh, viewerGate, proxy, redirect,
    installLifecycle };
}

module.exports = {
  HOSTED_ID_RE,
  HOSTED_MAX_CHILDREN,
  HOSTED_IDLE_MS,
  HOSTED_STDERR_LINES,
  HOSTED_FORWARD_HEADERS,
  HOSTED_CHILD_ENV,
  HOSTED_LOCKED_CSP,
  HOSTED_GONE,
  pageOrigin,
  hostedCsp,
  pageCsp,
  sameOriginCsp,
  documentLoad,
  HOSTED_NO_TOKEN,
  HOSTED_PYTHON_MODULES,
  HOSTED_TMP_ROOT,
  HOSTED_ALERT_ROUTES,
  HOSTED_DECISION_ROUTES,
  HOSTED_DECISION_REBUILD,
  redactSecrets,
  runPythonJson,
  pythonFor,
  childEnv,
  forwardedHeaders,
  relativeSource,
  safeLocalPath,
  workspaceFiles,
  createHostedRun,
};
