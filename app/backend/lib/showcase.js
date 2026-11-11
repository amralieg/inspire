const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('./appShell');
const { assetType, encodedCache, sendAsset } = require('./assetTypes');
const { parseExactJson } = require('./exactJson');
const { sameOriginCsp } = require('./hostedRun');
const { BACKEND_DIR } = require('./appPaths');

const SHOWCASE_VERSION = 1;
const SHOWCASE_HEADER = 'x-inspire-showcase';
const SHOWCASE_DIR = path.join(BACKEND_DIR, 'showcase');
const SHOWCASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SHOWCASE_FILE_RE = /\.json(\.gz)?$/;
const SHOWCASE_IGNORED = new Set(['inspire_database', 'warehouse_id', 'conversation_id', 'time_zone']);
const SHOWCASE_READ_ONLY = 'This is the demo, so nothing in it changes. Choose Get Started to find use cases and build MVPs on your own data.';
const SHOWCASE_MISSING = 'Not part of this demo.';
const SHOWCASE_UNKNOWN = 'This demo is not in this Inspire App.';
const SHOWCASE_GENIE = 'In the demo, Genie answers the questions it suggests. Ask your own questions in an MVP built on your data.';
const SHOWCASE_GENIE_ASK = 'POST /api/genie/ask';
const SHOWCASE_PLAN_DECIDE = 'POST /api/plan/decide';
const SHOWCASE_PLAN_NOTE = 'Demo decision: kept in this browser for the demo and saved nowhere else.';
const SHOWCASE_READS = new Set([
  'POST /api/page', 'POST /api/records', 'POST /api/overview', 'POST /api/genie/explain', 'POST /api/alerts/preview', 'POST /api/scenario/evaluate', 'POST /api/my_work',
  'POST /api/inspire/implement/readiness', 'POST /api/inspire/implement/plan', 'POST /api/inspire/implement/swaps',
]);
const SHELL_PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const SHOWCASE_MVP_API_RE = /^\/showcase\/[^/]+\/mvp\/[^/]+\/api\/(.+)$/;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function showcaseKey(method, pathname, query, body) {
  const params = Object.entries(query || {})
    .filter(([k, v]) => !SHOWCASE_IGNORED.has(k) && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  const search = new URLSearchParams(params).toString();
  const sent = isObject(body)
    ? Object.fromEntries(Object.entries(body).filter(([k]) => !SHOWCASE_IGNORED.has(k)))
    : body;
  const shown = sent === undefined || sent === null || (isObject(sent) && !Object.keys(sent).length) ? '' : ` ${canonicalJson(sent)}`;
  return `${String(method || 'GET').toUpperCase()} ${pathname}${search ? `?${search}` : ''}${shown}`;
}

function answersProblem(answers, where) {
  if (!isObject(answers)) return `${where} is not an object`;
  for (const [key, answer] of Object.entries(answers)) {
    if (!/^[A-Z]+ \/api\//.test(key)) return `${where} has the key ${JSON.stringify(key.slice(0, 80))}, which is not METHOD /api/...`;
    if (!isObject(answer) || !Number.isInteger(answer.status) || !('body' in answer)) return `${where} ${key.slice(0, 80)} has no status and body`;
    if ('text' in answer && (answer.text !== true || typeof answer.body !== 'string')) return `${where} ${key.slice(0, 80)} is a text answer without a text body`;
  }
  return '';
}

function showcaseProblem(bundle, file) {
  if (!isObject(bundle)) return `${file} is not a JSON object`;
  if (bundle.version !== SHOWCASE_VERSION) return `${file} is not version ${SHOWCASE_VERSION}`;
  if (!SHOWCASE_ID_RE.test(String(bundle.id || ''))) return `${file} has no valid id`;
  if (![`${bundle.id}.json`, `${bundle.id}.json.gz`].includes(path.basename(file))) return `${file} must be named ${bundle.id}.json or ${bundle.id}.json.gz`;
  for (const field of ['title', 'business', 'session_id']) {
    if (typeof bundle[field] !== 'string' || !bundle[field].trim()) return `${file} has no ${field}`;
  }
  const inspire = answersProblem(bundle.inspire, `${file} inspire`);
  if (inspire) return inspire;
  if (!isObject(bundle.mvps)) return `${file} has no mvps`;
  for (const [id, mvp] of Object.entries(bundle.mvps)) {
    if (!/^[A-Za-z0-9-]{1,20}$/.test(id)) return `${file} has the MVP id ${JSON.stringify(id)}`;
    if (!isObject(mvp) || typeof mvp.title !== 'string') return `${file} MVP ${id} has no title`;
    const api = answersProblem(mvp.api, `${file} MVP ${id} api`);
    if (api) return api;
    if (!mvp.api[showcaseKey('GET', '/api/app')]) return `${file} MVP ${id} has no answer for GET /api/app`;
  }
  return '';
}

function loadShowcases(dir = SHOWCASE_DIR) {
  const found = {};
  if (!fs.existsSync(dir)) return found;
  for (const name of fs.readdirSync(dir).filter((n) => SHOWCASE_FILE_RE.test(n)).sort()) {
    const file = path.join(dir, name);
    let bundle;
    try {
      const bytes = fs.readFileSync(file);
      bundle = parseExactJson((name.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes).toString('utf8'));
    } catch (e) {
      throw new Error(`the demo ${name} is not ${name.endsWith('.gz') ? 'gzip-compressed JSON' : 'valid JSON'}: ${e.message}`);
    }
    const problem = showcaseProblem(bundle, file);
    if (problem) throw new Error(`the demo ${problem}`);
    if (found[bundle.id]) throw new Error(`the demo ${bundle.id} is saved twice, as ${bundle.id}.json and ${bundle.id}.json.gz; keep one`);
    found[bundle.id] = bundle;
  }
  return found;
}

function showcaseSummary(bundle) {
  return {
    id: bundle.id,
    title: bundle.title,
    business: bundle.business,
    summary: typeof bundle.summary === 'string' ? bundle.summary : '',
    session_id: bundle.session_id,
    mvps: Object.entries(bundle.mvps).map(([id, mvp]) => ({ id, title: mvp.title, url: showcaseMvpPath(bundle.id, id) })),
  };
}

function showcaseMvpPath(id, mvpId) {
  return `/showcase/${encodeURIComponent(id)}/mvp/${encodeURIComponent(mvpId)}/`;
}

function showcaseCanRead(method, pathname) {
  const route = `${String(method).toUpperCase()} ${pathname}`;
  return route.startsWith('GET ') || route === SHOWCASE_GENIE_ASK || SHOWCASE_READS.has(route);
}

function showcaseLocal(method, pathname) {
  return `${String(method).toUpperCase()} ${pathname}` === SHOWCASE_PLAN_DECIDE;
}

function showcaseMiss(method, pathname) {
  if (`${String(method).toUpperCase()} ${pathname}` === SHOWCASE_GENIE_ASK) return { status: 404, error: SHOWCASE_GENIE };
  if (showcaseCanRead(method, pathname)) return { status: 404, error: SHOWCASE_MISSING };
  return { status: 403, error: SHOWCASE_READ_ONLY };
}

function refuseChange(res) {
  res.set('Cache-Control', 'no-store');
  return res.status(403).json({ error: SHOWCASE_READ_ONLY, showcase: true });
}

function showcaseWriteGuard(req, res, next) {
  const hosted = SHOWCASE_MVP_API_RE.exec(req.path);
  const demo = Boolean(hosted) || (req.path.startsWith('/api/') && Boolean(req.get(SHOWCASE_HEADER)));
  if (!demo || showcaseCanRead(req.method, hosted ? `/api/${hosted[1]}` : req.path)) return next();
  if (hosted && showcaseLocal(req.method, `/api/${hosted[1]}`)) return next();
  return refuseChange(res);
}

const SCREEN_ROUTES = { runs: 'GET /api/runs', impact: 'GET /api/impact', performance: 'POST /api/my_work', feedback: 'GET /api/feedback' };
const routeOf = (key) => key.replace(/\?.*$/, '').replace(/ \{.*$/, '');

function gatedApp(app, answers) {
  const routes = new Set(Object.keys(answers).map(routeOf));
  const off = Object.entries(SCREEN_ROUTES).filter(([, route]) => !routes.has(route)).map(([screen]) => [screen, false]);
  const alerting = isObject(app.alerting) && app.alerting.on && !routes.has('GET /api/alerts') ? { ...app.alerting, on: false } : app.alerting;
  return {
    ...app,
    ...(off.length ? { screens: { ...(isObject(app.screens) ? app.screens : {}), ...Object.fromEntries(off) } } : {}),
    ...(alerting !== app.alerting ? { alerting } : {}),
  };
}

function replay(res, answers, method, pathname, query, body) {
  const key = showcaseKey(method, pathname, query, body);
  const found = answers[key];
  const answer = found && key === 'GET /api/app' && isObject(found.body) ? { ...found, body: gatedApp(found.body, answers) } : found;
  res.set('Cache-Control', 'no-store');
  if (answer && answer.text) return res.status(answer.status).set('X-Content-Type-Options', 'nosniff').type('text/plain; charset=utf-8').send(answer.body);
  if (answer) return res.status(answer.status).json(answer.body);
  const miss = showcaseMiss(method, pathname);
  return res.status(miss.status).json({ error: miss.error, showcase: true });
}

function showcasePlanDecision(body) {
  const b = body && typeof body === 'object' ? body : {};
  const key = typeof b.record_key === 'string' ? b.record_key.trim() : '';
  const reason = typeof b.reason === 'string' ? b.reason.split(/\s+/).filter(Boolean).join(' ') : '';
  if (!key || !['accept', 'override'].includes(b.decision)) return { status: 400, body: { error: 'A plan decision needs a line and accept or override.', showcase: true } };
  const finite = (v) => v !== '' && v != null && Number.isFinite(Number(v));
  if (!finite(b.recommended)) return { status: 400, body: { error: 'A plan decision needs the recommended value of the line.', showcase: true } };
  if (b.decision === 'override' && (!Number.isFinite(Number(b.value)) || b.value === '' || b.value == null || !reason || reason.length > 300)) {
    return { status: 400, body: { error: 'An override needs your value and a reason of at most 300 characters.', showcase: true } };
  }
  const number = (v) => String(Number(v));
  const note = b.decision === 'accept' ? `Accepted the recommended ${number(b.recommended)}${reason ? `: ${reason}` : ''}`
    : `Override to ${number(b.value)} instead of ${number(b.recommended)}: ${reason}`.slice(0, 300);
  return { status: 200, body: { written: [key], conflicts: [], conflicts_count: 0, left_out: 0, batch_id: null, decision: b.decision, edited: false,
    showcase: true, saved: false, note: SHOWCASE_PLAN_NOTE, row: { _inspire_status: 'Done', _inspire_closed_note: note } } };
}

function restPath(rest) {
  return Array.isArray(rest) ? rest.join('/') : String(rest || '');
}

function registerShowcaseRoutes(app, { dir = SHOWCASE_DIR, shellFiles, log = console } = {}) {
  let showcases = {};
  let loadError = '';
  try {
    showcases = loadShowcases(dir);
  } catch (e) {
    loadError = e.message || String(e);
    log.error(`The demo is off: ${loadError}`);
  }
  let shell = shellFiles || null;
  const encodeShell = encodedCache();
  const shellFile = (name) => {
    if (!shell) shell = appShellFiles(appShellPayload(bundledAppShellText()));
    return shell[name];
  };
  const sentBody = (req) => (req.method === 'GET' ? undefined : req.body);

  app.get('/api/showcase', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      showcases: Object.values(showcases).map(showcaseSummary),
      ...(loadError ? { error: loadError } : {}),
    });
  });

  app.use('/api', (req, res, next) => {
    const id = req.get(SHOWCASE_HEADER);
    if (!id) return next();
    const bundle = showcases[id];
    if (!bundle) return res.status(404).json({ error: SHOWCASE_UNKNOWN, showcase: true });
    return replay(res, bundle.inspire, req.method, `/api${req.path}`, req.query, sentBody(req));
  });

  const mvpOf = (req, res) => {
    const bundle = showcases[req.params.id];
    const mvp = bundle && bundle.mvps[req.params.mvp];
    if (!mvp) {
      res.status(404).type('text/plain').send(SHOWCASE_UNKNOWN);
      return null;
    }
    return mvp;
  };

  app.all('/showcase/:id/mvp/:mvp/api/*rest', (req, res) => {
    const mvp = mvpOf(req, res);
    if (!mvp) return undefined;
    if (showcaseLocal(req.method, `/api/${restPath(req.params.rest)}`)) {
      const decided = showcasePlanDecision(req.body);
      return res.status(decided.status).set('Cache-Control', 'no-store').json(decided.body);
    }
    return replay(res, mvp.api, req.method, `/api/${restPath(req.params.rest)}`, req.query, sentBody(req));
  });

  const sendShell = (req, res, rel) => {
    if (!mvpOf(req, res)) return;
    if (!rel && !req.originalUrl.split('?')[0].endsWith('/')) {
      res.redirect(302, showcaseMvpPath(req.params.id, req.params.mvp));
      return;
    }
    const name = rel ? (SHELL_PATH_RE.test(rel) ? `static/${rel}` : null) : 'static/index.html';
    const type = name && assetType(name);
    const body = type && shellFile(name);
    if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
      res.status(404).set('X-Content-Type-Options', 'nosniff').type('text/plain').send(SHOWCASE_MISSING);
      return;
    }
    sendAsset(req, res, name, body, encodeShell, { 'Content-Security-Policy': sameOriginCsp() });
  };

  app.get('/showcase/:id/mvp/:mvp', (req, res) => sendShell(req, res, ''));
  app.get('/showcase/:id/mvp/:mvp/*rest', (req, res) => sendShell(req, res, restPath(req.params.rest)));
}

module.exports = {
  SHOWCASE_GENIE_ASK,
  SHOWCASE_PLAN_DECIDE,
  SHOWCASE_PLAN_NOTE,
  showcasePlanDecision,
  SHOWCASE_VERSION,
  SHOWCASE_HEADER,
  SHOWCASE_DIR,
  SHOWCASE_READ_ONLY,
  SHOWCASE_MISSING,
  SHOWCASE_UNKNOWN,
  SHOWCASE_GENIE,
  showcaseKey,
  showcaseCanRead,
  showcaseLocal,
  showcaseMiss,
  showcaseProblem,
  gatedApp,
  loadShowcases,
  showcaseSummary,
  showcaseMvpPath,
  showcaseWriteGuard,
  registerShowcaseRoutes,
};
