const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('./appShell');
const { assetType, encodedCache, sendAsset } = require('./assetTypes');
const { parseExactJson } = require('./exactJson');
const { sameOriginCsp } = require('./hostedRun');
const { BACKEND_DIR } = require('./appPaths');
const { displayText } = require('../../shared/useCaseId.mjs');

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
// REQ-431: routes every shell page asks that the recorded demos hold no (or a recorded 404) answer for; the demo answers them itself.
const SHOWCASE_PLAN_WHY = 'This is the demo: lines you decide are kept in this browser, and plan versions are not kept.';
const SHOWCASE_NO_TRENDS = 'The demo keeps no action history, so it has no trends to show.';
const SHOWCASE_NO_SCENARIOS = 'The demo saves no scenarios; the ones you try are not kept.';
const SHOWCASE_NO_REVIEW = 'The demo keeps no forecast review cycles, so there are no series to review here.';
const SHOWCASE_NO_ACCURACY = 'The demo keeps no overrides or past actuals, so it cannot measure the forecast.';
const SHOWCASE_BUILTIN = {
  'GET /api/agent/status': { status: 200, body: { mode: 'genie', note: '' } },
  // REQ-527 (RC6-A-04): the value chip's counter and board; the demo counts no saved value, so the chip shows the unset state.
  'GET /api/value/counter': { status: 200, body: { shown: false } },
  'GET /api/value/leaders': { status: 200, body: { shown: false } },
  // REQ-527 (RC6-A-04): reads a click on a demo page can make that no recording holds; the demo keeps no change history, no similar lines and no ticket actions.
  'GET /api/records/batches': { status: 200, body: { batches: [] } },
  'GET /api/records/similar': { status: 200, body: { count: 0 } },
  'GET /api/records/population': { status: 200, body: { text: '' } },
  'GET /api/agent/briefing': { status: 200, body: { actions: [] } },
  'GET /api/plans': { status: 200, body: { can_decide: false, can_approve: false, why: SHOWCASE_PLAN_WHY, approve_why: SHOWCASE_PLAN_WHY, contract: 'plan',
    states: ['Draft', 'In review', 'Approved', 'Published'], missing: '', constraints: [], constraints_error: '',
    versions: [{ plan_id: 'demo', number: 1, label: 'Version 1', status: 'Draft', editable: true, overrides: [], changed_by: '' }] } },
  'GET /api/plans/performance': { status: 200, body: { version: null, missing: '', empty: 'The demo keeps no plan versions, so there is nothing to compare with the actuals.' } },
  // The empty or explained state of each page, in the shape the live server answers when it has nothing to show. No data is invented.
  'GET /api/records/history': { status: 200, body: { record_key: '', fields: [], versions: [], current: null, deleted: false, truncated: false } },
  'GET /api/feedback': { status: 200, body: { items: [], everyone: false, missing: false, limit: 2000 } },
  'GET /api/trends': { status: 200, body: { visible: true, tracked: true, actions: false, note: SHOWCASE_NO_TRENDS } },
  'GET /api/scenario/saved': { status: 200, body: { scenarios: [], decisions: [], mine: 0, note: SHOWCASE_NO_SCENARIOS } },
  'GET /api/forecast/review': { status: 200, body: { can_decide: false, can_approve: false, why: SHOWCASE_PLAN_WHY, approve_why: SHOWCASE_PLAN_WHY, cycle: null, cycles: 0,
    series: [], at_risk: 0, missing: SHOWCASE_NO_REVIEW, states: ['Draft', 'In review', 'Approved', 'Published'] } },
  'GET /api/forecast/accuracy': { status: 200, body: { points: 0, series: 0, error: null, bias: null, mase: null, overrides: 0, helped: 0, hurt: 0, lift: null,
    lift_note: SHOWCASE_NO_ACCURACY } },
};
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
    // REQ-560: a document the run saved is replayed byte for byte, so its answer is base64 with the content type it was served with.
    if ('base64' in answer && (answer.base64 !== true || typeof answer.body !== 'string' || typeof answer.type !== 'string' || !answer.type)) return `${where} ${key.slice(0, 80)} is a base64 answer without a base64 string body and a content type`;
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

// REQ-560: what a recording made by an older build lacks. A shipped demo must hold the value reads, the listing of the run's output
// folder, the export of a generated document, an MVP App with data, and the build stamp it was recorded with.
const DOCUMENT_EXPORT_RE = /^GET \/api\/workspace\/export\?(?:.*&)?path=[^&]*\.(?:pdf|pptx|docx|xlsx)(?:&|$)/i;

function showcaseStale(bundle) {
  const ok = (answers) => Object.entries(isObject(answers) ? answers : {}).filter(([, a]) => isObject(a) && a.status === 200).map(([k]) => k);
  const keys = ok(bundle.inspire);
  const stale = [];
  const value = (name) => keys.some((k) => k === `GET /api/inspire/value/${name}` || k.startsWith(`GET /api/inspire/value/${name}?`));
  if (!['totals', 'yearly', 'estimates'].every(value)) stale.push('no value reads');
  if (!keys.some((k) => k.startsWith('GET /api/workspace/list?'))) stale.push('no listing of the output folder');
  if (!keys.some((k) => DOCUMENT_EXPORT_RE.test(k))) stale.push('no export of a generated document');
  const apps = Object.values(isObject(bundle.mvps) ? bundle.mvps : {});
  if (!apps.some((m) => isObject(m) && ok(m.api).length >= 2 && ok(m.api).includes('GET /api/app'))) stale.push('no MVP App');
  if (typeof bundle.build !== 'string' || !bundle.build.trim()) stale.push('no build stamp');
  return stale;
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

// REQ-527 (RC6-A-04): the shell asks the same list with view keys the recording never held (the To-do's open-status column filter,
// added after the demos were recorded). The demo answers with the recorded list of the same page and the same filters: the view keys
// narrow a list the demo already shows in full, and a different page or filter set is still a miss.
const SHOWCASE_LIST = 'POST /api/records';
function recordedList(answers, body) {
  if (!isObject(body) || typeof body.page !== 'string') return undefined;
  const want = canonicalJson(body.filters || {});
  const asked = Number(body.limit) || 0;
  const same = Object.keys(answers).filter((k) => k.startsWith(`${SHOWCASE_LIST} {`) && answers[k].status === 200)
    .map((k) => ({ k, sent: parseExactJson(k.slice(SHOWCASE_LIST.length + 1)) }))
    .filter(({ sent }) => isObject(sent) && sent.page === body.page && canonicalJson(sent.filters || {}) === want);
  // the smallest recorded list that holds the rows asked for, else the largest one
  const rank = ({ sent }) => { const n = Number(sent.limit) || 0; return n >= asked ? n - asked : Infinity; };
  same.sort((a, b) => (rank(a) - rank(b)) || ((Number(b.sent.limit) || 0) - (Number(a.sent.limit) || 0)));
  return same.length ? answers[same[0].k] : undefined;
}

// REQ-569: the demo files keep the ids as recorded (Nx-Ux) and are never rewritten; a sentence a person reads prints AIx-UCx. An id on its
// own and a URL or path holding one stay as recorded, because the shell sends them back as lookups.
const STORED_ID_ONLY = /^N\d+-U\d+$/;
const ID_IN_PATH = /\/N\d+-U\d+(\/|$)/;
function showcaseDisplay(value) {
  if (typeof value === 'string') return STORED_ID_ONLY.test(value) || ID_IN_PATH.test(value) ? value : displayText(value);
  if (Array.isArray(value)) return value.map(showcaseDisplay);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, showcaseDisplay(v)]));
  return value;
}

function replay(res, answers, method, pathname, query, body) {
  const key = showcaseKey(method, pathname, query, body);
  const recorded = answers[key];
  const builtin = SHOWCASE_BUILTIN[`${String(method).toUpperCase()} ${pathname}`];
  const listed = !recorded && `${String(method).toUpperCase()} ${pathname}` === SHOWCASE_LIST ? recordedList(answers, body) : undefined;
  const found = builtin && (!recorded || recorded.status === 404) ? builtin : recorded || listed;
  const answer = found && key === 'GET /api/app' && isObject(found.body) ? { ...found, body: gatedApp(found.body, answers) } : found;
  res.set('Cache-Control', 'no-store');
  if (answer && answer.base64) return res.status(answer.status).set('X-Content-Type-Options', 'nosniff').type(answer.type).send(Buffer.from(answer.body, 'base64'));
  if (answer && answer.text) return res.status(answer.status).set('X-Content-Type-Options', 'nosniff').type('text/plain; charset=utf-8').send(showcaseDisplay(answer.body));
  if (answer) return res.status(answer.status).json(showcaseDisplay(answer.body));
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
  showcaseDisplay,
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
  showcaseStale,
  gatedApp,
  loadShowcases,
  showcaseSummary,
  showcaseMvpPath,
  showcaseWriteGuard,
  registerShowcaseRoutes,
};
