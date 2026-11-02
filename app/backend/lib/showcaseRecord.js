const { SHOWCASE_VERSION, showcaseKey, showcaseMvpPath, showcaseProblem } = require('./showcase');
const zlib = require('zlib');
const { plural } = require('./plural');

const DEMO_HOST = 'https://workspace.example.com';
const DEMO_WORKSPACE = 'demo-workspace';
const DEMO_UUID = '00000000-0000-4000-8000-';
const OBJECT_ID = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/;
const WAREHOUSE_ID = /(?<![0-9a-f])(?=[0-9a-f]{0,15}[a-f])(?=[0-9a-f]{0,15}\d)[0-9a-f]{16}(?![0-9a-f])/;
const WORKSPACE_NAME = /\bdbc-[0-9a-f]{8}-[0-9a-f]{4}\b/;
const LONG_NUMBER = /(?<!\d)(?<!\d\.)\d{12,}(?!\d)/;
const PRIVATE_RE = new RegExp([
  /(https?:\/\/[A-Za-z0-9.-]+\.(?:cloud\.databricks\.com|azuredatabricks\.net|gcp\.databricks\.com|databricks\.com|databricksapps\.com))/,
  /((?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24})/,
  /((?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f]))/,
  new RegExp(`(${OBJECT_ID.source})`),
  new RegExp(`(${LONG_NUMBER.source})`),
  /(\bapp-(?=[a-z]*\d)[a-z0-9]{6}\b)/,
  new RegExp(`(${WAREHOUSE_ID.source})`),
  new RegExp(`(${WORKSPACE_NAME.source})`),
].map((re) => re.source).join('|'), 'gi');
const TIME_KEY_RE = /(?:time|date|_at|_ms|_ts|timestamp|created|updated|modified|started|ended)$/i;
const TIME_VALUE_RE = /^[\d\s:.+TZ-]+$/;
const HOSTED_URLS = ['app_url', 'dashboard_url', 'genie_space_url'];

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isTime = (key, v) => TIME_KEY_RE.test(key) && TIME_VALUE_RE.test(String(v));

function makeSanitizer({ replace = {}, sessionId = '', mvpUrls = {}, hostedPaths = {} } = {}) {
  const pairs = Object.entries(replace).filter(([from]) => from).sort(([a], [b]) => b.length - a.length);
  const fakes = new Map();
  const counts = {};
  const fake = (kind, raw, make) => {
    const k = `${kind}:${raw.toLowerCase()}`;
    if (!fakes.has(k)) {
      counts[kind] = (counts[kind] || 0) + 1;
      fakes.set(k, make(counts[kind]));
    }
    return fakes.get(k);
  };
  const number = (raw) => fake('n', raw, (n) => String(1000 + n));
  if (sessionId) {
    const sid = number(String(sessionId));
    const parsed = Number(sessionId);
    if (Number.isInteger(parsed)) fakes.set(`n:${String(parsed).toLowerCase()}`, sid);
  }
  const origins = Object.entries(mvpUrls)
    .map(([id, url]) => [new URL(url).origin, hostedPaths[id]])
    .filter(([, to]) => to);

  const text = (input) => {
    let s = String(input);
    for (const [origin, to] of origins) s = s.split(`${origin}/`).join(to).split(origin).join(to);
    for (const [from, to] of pairs) s = s.split(from).join(to);
    return s.replace(PRIVATE_RE, (m, host, email, uuid, hex, long, app, warehouse) => {
      if (host) return DEMO_HOST;
      if (email) return email.toLowerCase().endsWith('@example.com') ? email : fake('e', email, (n) => `person${n}@example.com`);
      if (uuid) return uuid.toLowerCase().startsWith(DEMO_UUID) ? uuid : fake('u', uuid, (n) => `${DEMO_UUID}aaaa${String(n).padStart(8, '0')}`);
      if (hex) return fake('h', hex, (n) => `demo${'x'.repeat(20)}${String(n).padStart(8, '0')}`);
      if (long) return number(long);
      if (app) return 'app-demo00';
      if (warehouse) return fake('w', warehouse, (n) => `demowhxx${String(n).padStart(8, '0')}`);
      return DEMO_WORKSPACE;
    });
  };

  const value = (v, key = '') => {
    if (typeof v === 'string') {
      if (isTime(key, v)) return v;
      const s = text(v);
      return /^https?:\/\//i.test(v.trim()) && s.trim().startsWith(DEMO_HOST) ? '' : s;
    }
    if (typeof v === 'number') {
      if (!Number.isInteger(v) || Math.abs(v) < 1e11 || isTime(key, v)) return v;
      return Number(number(String(v)));
    }
    if (Array.isArray(v)) return v.map((x) => value(x, key));
    if (!isObject(v)) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) out[text(k)] = value(x, k);
    const hosted = typeof v.use_case_id === 'string' ? hostedPaths[v.use_case_id] : '';
    if (hosted) for (const k of HOSTED_URLS) if (typeof v[k] === 'string' && v[k].trim()) out[k] = hosted;
    return out;
  };

  return { text, value };
}

function onlySession(body, sessionId) {
  if (!isObject(body)) return body;
  const sid = String(sessionId);
  if (Array.isArray(body.sessions)) return { ...body, sessions: body.sessions.filter((s) => isObject(s) && String(s.session_id) === sid) };
  if (isObject(body.sessions)) return { ...body, sessions: Object.fromEntries(Object.entries(body.sessions).filter(([key]) => key === sid)) };
  return body;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : s);
const MONITOR_STEP = ['step_id', 'stage_name', 'step_name', 'sub_step_name', 'status', 'message', 'last_updated', 'progress_increment'];
const MONITOR_RESULT = ['error', 'prompt_name', 'use_cases_count', 'is_truncated', 'scored_count', 'domains_count', 'response_chars', 'rows_count', 'batch_rows'];
const MONITOR_USE_CASE = ['name', 'Name', 'id', 'No', 'domain', 'Business Domain', 'priority', 'Priority', 'quality', 'Quality'];
const MONITOR_SESSION = ['session_id', 'processing_status', 'completed_percent', 'completed_on', 'create_at', 'last_updated'];
const MONITOR_WIDGETS = ['discovery_type', 'strategic_context'];
const MONITOR_PREVIEW = 201;

function monitorResult(rj) {
  if (!isObject(rj)) return rj;
  const out = pick(rj, MONITOR_RESULT);
  const rows = (list) => list.map((u) => (isObject(u) ? pick(u, MONITOR_USE_CASE) : u));
  if (Array.isArray(rj.use_cases)) out.use_cases = rows(rj.use_cases);
  if (Array.isArray(rj.scored_use_cases)) out.scored_use_cases = rows(rj.scored_use_cases);
  if (Array.isArray(rj.domains)) out.domains = rj.domains.map((d) => (isObject(d) ? pick(d, ['domain_name', 'use_case_ids']) : d));
  if (typeof rj.sql_preview === 'string') out.sql_preview = clip(rj.sql_preview, MONITOR_PREVIEW);
  if (isObject(rj.json)) out.json = { ...pick({ business_context: clip(rj.json.business_context, MONITOR_PREVIEW) }, ['business_context']), ...pick(rj.json, ['strategic_goals']) };
  return out;
}

function monitorStep(step) {
  return isObject(step) ? { ...pick(step, MONITOR_STEP), ...('result_json' in step ? { result_json: monitorResult(step.result_json) } : {}) } : step;
}

function demoTotals(body, sessionId) {
  const figures = isObject(body.sessions) ? body.sessions[String(sessionId)] : null;
  const zero = Object.fromEntries(Object.keys(isObject(body.totals) ? body.totals : {}).map((k) => [k, 0]));
  return { ...body, totals: { ...zero, ...(isObject(figures) ? figures : {}), businesses: 1, runs: 1 }, truncated: false };
}

const UNREAD_USE_CASE_FIELDS = ['code_structure_mandate'];
const withoutUnread = (row) => (isObject(row) ? Object.fromEntries(Object.entries(row).filter(([k]) => !UNREAD_USE_CASE_FIELDS.includes(k))) : row);

const DEMO_VIEWS = {
  'GET /api/inspire/portfolio': demoTotals,
  'GET /api/inspire/usecases': (body) => (Array.isArray(body.usecases) ? { ...body, usecases: body.usecases.map(withoutUnread) } : body),
  'GET /api/inspire/steps': (body) => (Array.isArray(body.steps) ? { ...body, steps: body.steps.map(monitorStep) } : body),
  'GET /api/inspire/session': (body) => (isObject(body.session) ? {
    ...body,
    session: { ...pick(body.session, MONITOR_SESSION), ...(isObject(body.session.widget_values) ? { widget_values: pick(body.session.widget_values, MONITOR_WIDGETS) } : {}) },
  } : body),
};

function demoView(method, url, body, sessionId) {
  const shown = onlySession(body, sessionId);
  const view = DEMO_VIEWS[`${String(method || 'GET').toUpperCase()} ${new URL(url, 'http://showcase.invalid').pathname}`];
  return view && isObject(shown) ? view(shown, sessionId) : shown;
}

function otherSession(exchange, sessionId) {
  const sid = String(sessionId);
  const asked = new URL(exchange.url, 'http://showcase.invalid').searchParams.get('session_id');
  const sent = parsedBody(exchange.postData);
  const posted = isObject(sent) && sent.session_id !== undefined && sent.session_id !== null ? String(sent.session_id) : null;
  return [asked, posted].some((v) => v !== null && v !== '' && v !== sid);
}

function parsedBody(postData) {
  if (postData === undefined || postData === null || postData === '') return undefined;
  if (typeof postData !== 'string') return postData;
  try {
    return JSON.parse(postData);
  } catch {
    return postData;
  }
}

function mvpUrlsFrom(exchanges, ids) {
  const wanted = new Set(ids);
  const found = {};
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      const url = typeof v.app_url === 'string' ? v.app_url.trim() : '';
      if (wanted.has(v.use_case_id) && /^https:\/\//.test(url) && !found[v.use_case_id]) found[v.use_case_id] = url;
      Object.values(v).forEach(walk);
    }
  };
  for (const exchange of exchanges) if (exchange.status < 300) walk(exchange.body);
  return found;
}

const SHOWCASE_FILE_ROUTES = new Set(['GET /api/workspace/export']);

function stepsAsText(body) {
  const steps = isObject(body) && Array.isArray(body.steps) ? body.steps : [];
  return steps.some((step) => isObject(step) && typeof step.result_json === 'string' && /^\s*[[{]/.test(step.result_json));
}

function notJson({ method, type, unparsed, body }, pathname) {
  const kind = typeof type === 'string' ? type : '';
  if (SHOWCASE_FILE_ROUTES.has(`${String(method).toUpperCase()} ${pathname}`)) return /html/i.test(kind) ? kind : '';
  if (kind && !/json/i.test(kind)) return kind;
  if (typeof body === 'string' && body.trimStart().startsWith('<')) return 'markup';
  if (unparsed) return 'a body that is not JSON';
  return '';
}

function makeRecorder({ id, title, business, summary = '', sessionId, replace = {}, mvps = [] }) {
  if (!sessionId) throw new Error('a demo recording needs the session id');
  const hostedPaths = Object.fromEntries(mvps.map((m) => [m.id, showcaseMvpPath(id, m.id)]));
  const mvpUrls = Object.fromEntries(mvps.filter((m) => m.url).map((m) => [m.id, m.url]));
  const clean = makeSanitizer({ replace, sessionId, mvpUrls, hostedPaths });
  const inspire = {};
  const apps = Object.fromEntries(mvps.map((m) => [m.id, {}]));
  const notJsonAnswers = [];
  const textSteps = [];

  const keyOf = ({ method, url, postData }) => {
    const u = new URL(url, 'http://showcase.invalid');
    const query = {};
    for (const [k, v] of u.searchParams) query[k] = clean.text(v);
    return showcaseKey(method, clean.text(u.pathname), query, clean.value(parsedBody(postData)));
  };

  const add = (answers, exchange, where) => {
    const { pathname } = new URL(exchange.url, 'http://showcase.invalid');
    if (!pathname.startsWith('/api/')) return '';
    if (!Number.isInteger(exchange.status) || exchange.status >= 500) return '';
    if (otherSession(exchange, sessionId)) return '';
    const key = keyOf(exchange);
    const wrong = notJson(exchange, pathname);
    if (wrong) {
      notJsonAnswers.push(`${where}${key.slice(0, 160)} (${wrong})`);
      return '';
    }
    const body = exchange.body === undefined ? null : exchange.body;
    if (exchange.status < 300 && stepsAsText(body)) {
      textSteps.push(`${where}${key.slice(0, 160)}`);
      return '';
    }
    const text = typeof exchange.type === 'string' && exchange.type !== '' && typeof body === 'string';
    answers[key] = { status: exchange.status, body: clean.value(exchange.status < 300 ? demoView(exchange.method, exchange.url, body, sessionId) : body), ...(text ? { text: true } : {}) };
    return key;
  };

  return {
    keyOf,
    addInspire: (exchange) => add(inspire, exchange, ''),
    addMvp: (mvpId, exchange) => {
      if (!apps[mvpId]) throw new Error(`the MVP ${mvpId} is not in this recording`);
      return add(apps[mvpId], exchange, `MVP ${mvpId} `);
    },
    bundle: () => {
      if (notJsonAnswers.length) {
        throw new Error(`the App answered ${plural(notJsonAnswers.length, 'API route')} with something other than JSON, so the installed App does not serve them (an older App answers with its page); install this build first: ${notJsonAnswers.slice(0, 20).join(', ')}`);
      }
      if (textSteps.length) {
        throw new Error(`the App sent the build steps of ${plural(textSteps.length, 'answer')} as JSON text inside JSON, as an App older than this build does, so the demo would show no build stages; install this build first: ${textSteps.slice(0, 20).join(', ')}`);
      }
      const out = {
        version: SHOWCASE_VERSION,
        id,
        title: clean.text(title),
        business: clean.text(business),
        summary: clean.text(summary),
        session_id: clean.text(String(sessionId)),
        inspire,
        mvps: Object.fromEntries(mvps.map((m) => [m.id, { title: clean.text(m.title || m.id), api: apps[m.id] }])),
      };
      const problem = showcaseProblem(out, `${id}.json`);
      if (problem) throw new Error(problem);
      return out;
    },
  };
}

const LEAK_PATTERNS = [
  ['a workspace host', /\.(?:cloud\.databricks\.com|azuredatabricks\.net|gcp\.databricks\.com|databricksapps\.com)/i],
  ['an email outside example.com', /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?!example\.com\b)[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/],
  ['a number of 12 or more digits', LONG_NUMBER],
  ['an id that is not a demo id', new RegExp(`(?<![0-9a-f])(?!${DEMO_UUID})[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])`, 'i')],
  ['an App service principal name', /\bapp-(?!demo00\b)(?=[a-z]*\d)[a-z0-9]{6}\b/],
  ['a Databricks object id', new RegExp(OBJECT_ID.source, 'i')],
  ['a warehouse id', new RegExp(WAREHOUSE_ID.source, 'i')],
  ['a workspace name', new RegExp(WORKSPACE_NAME.source, 'i')],
];

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function showcaseLeaks(bundle, banned = []) {
  const patterns = [...LEAK_PATTERNS, ...banned.filter(Boolean).map((s) => [`the text ${JSON.stringify(s)}`, new RegExp(escaped(s), 'i')])];
  const found = [];
  const check = (where, s) => {
    for (const [what, re] of patterns) {
      const m = s.match(re);
      if (m) found.push(`${where}: ${what} in ...${s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)}...`);
    }
  };
  const walk = (v, key, where) => {
    if (typeof v === 'string' || typeof v === 'number') {
      if (!isTime(key, v)) check(where, String(v));
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, key, `${where}[${i}]`));
    else if (isObject(v)) {
      for (const [k, x] of Object.entries(v)) {
        check(`${where} key`, k);
        walk(x, k, `${where}.${k.slice(0, 60)}`);
      }
    }
  };
  walk(bundle, '', 'bundle');
  return found;
}

const SHOWCASE_MAX_BYTES = 5000000;

function showcaseText(bundle) {
  return `${JSON.stringify(bundle, null, 1)}\n`;
}

function showcaseFile(bundle) {
  return zlib.gzipSync(Buffer.from(showcaseText(bundle), 'utf8'), { level: 9 });
}

function showcaseSizes(bundle) {
  return { json: Buffer.byteLength(showcaseText(bundle)), gzip: showcaseFile(bundle).length };
}

function showcaseSizeProblem(bundle, max = SHOWCASE_MAX_BYTES) {
  const { json, gzip: size } = showcaseSizes(bundle);
  if (size <= max) return '';
  const answers = [
    ...Object.entries(bundle.inspire || {}),
    ...Object.entries(bundle.mvps || {}).flatMap(([id, mvp]) => Object.entries((mvp && mvp.api) || {}).map(([key, answer]) => [`MVP ${id} ${key}`, answer])),
  ].map(([key, answer]) => [key, Buffer.byteLength(JSON.stringify(answer))]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `the demo is ${size} bytes compressed (${json} bytes of JSON), over the cap of ${max} bytes; the largest answers are ${answers.map(([key, n]) => `${key.slice(0, 120)} (${n} bytes)`).join(', ')}`;
}

module.exports = {
  DEMO_HOST, SHOWCASE_FILE_ROUTES, SHOWCASE_MAX_BYTES, UNREAD_USE_CASE_FIELDS, demoView, makeSanitizer, makeRecorder, monitorStep, mvpUrlsFrom, onlySession,
  showcaseFile, showcaseLeaks, showcaseSizeProblem, showcaseSizes, showcaseText,
};
