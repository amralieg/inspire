import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { ensureDist } from './freshDist.mjs';
import { INBOX_ROWS } from '../src/inbox.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
export const SRC = join(HERE, '..', 'src');
export const fileNames = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
const REPO = join(HERE, '..', '..', '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
await ensureDist();
export const CONTRACT = JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', 'app_usability_contract.json'), 'utf8'));
export const SILENT = {
  run_id: null, trigger: null, by: '', started: '2026-10-27T09:00:30Z', ended: null, duration_s: null,
  state: 'silent', result: 'unknown', message: 'No news from this run since 09:08 UTC. It may have stopped.', url: '',
  source: 'marker', confirmed: false, stage: 'Running the use case', stage_index: 2, stage_total: 5, rows_done: null,
  rows_total: null, percent: null, eta_s: null, silent_since: '2026-10-27T09:08:20Z',
};
export const LOST = {
  run_id: null, trigger: null, by: '', started: '2026-10-27T08:00:30Z', ended: null, duration_s: null, state: 'lost', result: 'unknown',
  message: 'No news from this run since 08:10 UTC. It may have stopped.', url: '', source: 'marker',
};

const APP_INFO = `
import copy, json, os, sys, tempfile
sys.path.insert(0, sys.argv[1])
import shell_core
settings, count = json.loads(sys.argv[3]), int(sys.argv[4])
with open(sys.argv[2], encoding="utf-8") as handle:
    first = json.load(handle)
first.update(json.loads(sys.argv[5]))
root = tempfile.mkdtemp()
os.mkdir(os.path.join(root, shell_core.PAGES_DIR))
settings["pages"] = []
for i in range(count):
    page = copy.deepcopy(first)
    if i:
        page.update(id=f"n02_u0{i}", title=f"Second desk {i}", use_case_id=f"N02-U0{i}", hue="teal", icon="truck")
        if page.get("review"):
            page["review"] = page["review"].rsplit("&uc=", 1)[0] + "&uc=" + page["use_case_id"]
        if "genie" not in json.loads(sys.argv[5]):
            page["genie"] = ({"space_id": settings["genie"]["space_id"] + str(i), "title": page["title"]} if settings.get("genie")
                             else None)
            page["genie_note"] = "" if settings.get("genie") else settings.get("genie_note") or ""
    settings["pages"].append(page["id"])
    with open(os.path.join(root, shell_core.PAGES_DIR, page["id"] + ".json"), "w", encoding="utf-8") as handle:
        json.dump(page, handle)
with open(os.path.join(root, shell_core.SETTINGS_FILE), "w", encoding="utf-8") as handle:
    json.dump(settings, handle)
shell = shell_core.Shell(root, env={"DATABRICKS_HOST": "https://example.com", "DATABRICKS_WAREHOUSE_ID": "w1"})
print(json.dumps(shell.app_info({"x-forwarded-email": "pat.lee@example.com", "x-forwarded-access-token": "t"})))
`;

export const TABLE = { result_table: 'main.pricing.loss_desk_out' };
export const OWN_CHOICES = [{ id: 'reprice', label: 'Reprice', status: 'In progress' }, { id: 'keep', label: 'Keep the price', status: 'Done' },
  { id: 'drop', label: 'Drop the item', status: 'Done' }, { id: 'wrong', label: 'Wrong flag', status: 'Dismissed', reasons: ['Data error', 'Seasonal'] }];
const EXAMPLE_PAGE = JSON.parse(readFileSync(join(REPO, 'agent', 'app_shell', 'example_page.json'), 'utf8'));
export const OWN_STATUSES = { ...TABLE, records: { ...EXAMPLE_PAGE.records, choices: OWN_CHOICES } };
export const GENIE_ONLY = { mode: 'genie', note: '', genie: true, model: '' };

export function appInfo(overrides = {}, pages = 1, pageChanges = {}, example = 'example_page.json') {
  const settings = {
    version: 2, title: 'Pricing desk', subtitle: '', style: 'a', layout: 'sidebar', auth: 'sp', theme: 'light', palette: 'default',
    options: { modify: false, replace_edits: false, decisions: false },
    genie: { space_id: '01f0aa11bb22cc33', title: 'Pricing desk' }, built_at: '2026-10-26T10:00:00Z',
    admin: ['owner', 'example.com'].join('@'), jobs: {}, ...overrides,
  };
  const out = execFileSync('python3', ['-c', APP_INFO, join(REPO, 'agent', 'app_shell', 'server'), join(REPO, 'agent', 'app_shell', example),
    JSON.stringify(settings), String(pages), JSON.stringify(pageChanges)], { encoding: 'utf8' });
  return JSON.parse(out);
}

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 10));
export const chartsDrawn = (n) => [...document.querySelectorAll('[data-card]')].filter((c) => c.querySelector('canvas')).length === n;

export async function resizeTo(page, width, height = 900) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(() => {
    const now = [document.documentElement.scrollWidth, document.body.clientWidth].join();
    const seen = window.__inspireSettle;
    if (!seen || seen.now !== now) {
      window.__inspireSettle = { now, at: performance.now() };
      return false;
    }
    return performance.now() - seen.at > 300;
  }, null, { polling: 50, timeout: 10000 });
  await page.evaluate(() => { delete window.__inspireSettle; });
}

export function watchScrolls(motion) {
  return async (page) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.addInitScript(() => {
      window.__scrolls = [];
      for (const name of ['scrollIntoView', 'scrollTo']) {
        const real = Element.prototype[name];
        Element.prototype[name] = function watched(...args) {
          window.__scrolls.push(args[0] && typeof args[0] === 'object' ? args[0].behavior || 'auto' : 'auto');
          return real.apply(this, args);
        };
      }
    });
  };
}

export const scrollsAsked = (page) => page.evaluate(() => window.__scrolls.splice(0));

export async function holdClock(page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

export async function goRail(page, id) {
  const menu = page.getByRole('button', { name: 'Open the sections' });
  if (await menu.isVisible()) await menu.click();
  await page.locator(`[data-rail="${id}"]`).click();
}

export async function pickCase(page, title) {
  await page.locator('[data-switcher]').click();
  await page.locator('[data-case]', { hasText: title }).click();
}
export const toastSays = (page, text) => page.waitForFunction((t) => document.querySelector('.toast .toast-t')?.textContent === t, text);

export function prefsFirst(key, person, prefs) {
  return (page) => page.addInitScript(([k, who, value]) => {
    if (!/^https?:$/.test(location.protocol) || localStorage.getItem(k) !== null) return;
    localStorage.setItem(k, JSON.stringify({ [who]: value }));
  }, [key, person, prefs]);
}

export async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}
const CATS = ['Books', 'Music', 'Home', 'Garden', 'Toys', 'Sports'];
const CHANNELS = ['Store', 'Web', 'Catalog'];

export function pageData(filters) {
  const cats = filters?.category?.length ? CATS.filter((c) => filters.category.includes(c)) : CATS;
  const scale = cats.length / CATS.length;
  return {
    kpis: { total_loss: { now: 1234567 * scale, before: 1100000 * scale }, loss_rate: { now: 4.2, before: 4.6 }, items: { now: 48 * scale, before: null } },
    charts: {
      loss_trend: { columns: [], rows: MONTHS.map((m, i) => ({ x: m, y0: (90000 + i * 4000) * scale })), truncated: false },
      by_category: { columns: [], rows: cats.map((c, i) => ({ x: c, y0: 300000 - i * 40000 })), truncated: false },
      channel_mix: { columns: [], rows: MONTHS.flatMap((m, i) => CHANNELS.map((s, j) => ({ x: m, s, y0: 20000 + i * 900 + j * 5000 }))), truncated: false },
      pareto: { columns: [], rows: cats.map((c, i) => ({ x: c, y0: 300000 - i * 40000, total: 1500000 })), truncated: false },
    },
    tables: {},
    records: {
      columns: [], truncated: false,
      rows: Array.from({ length: 30 }, (_, i) => ({
        entity_id: `R${String(i + 1).padStart(3, '0')}`, entity_label: `Item number ${i + 1} with a long descriptive name`, category: CATS[i % 6],
        channel: CHANNELS[i % 3], region: i % 2 ? 'North' : 'South', priority_tier: ['Act now', 'Review', 'Monitor'][i % 3], rank: i + 1,
        value: 50000 - i * 1000, recommended_action: 'Cut the standing discount to 10%', top_reasons: ['high discount depth', 'falling margin'],
        as_of_date: '2026-10-15',
      })),
    },
    errors: {},
  };
}

export const FILTERS = {
  filters: [
    { id: 'run_date', type: 'date_range', label: 'Run date', grain: 'month', default: '12m', low: '2024-01-05', high: '2026-10-15',
      presets: [{ id: '3m', label: 'Last 3 months', from: '2026-08-01', to: '2026-10-15' }, { id: '6m', label: 'Last 6 months', from: '2026-05-01', to: '2026-10-15' },
        { id: '12m', label: 'Last 12 months', from: '2025-11-01', to: '2026-10-15' }, { id: '24m', label: 'Last 24 months', from: '2024-11-01', to: '2026-10-15' },
        { id: 'all', label: 'All time', from: '2024-01-05', to: '2026-10-15' }] },
    { id: 'category', type: 'multi_select', label: 'Category', options: CATS },
    { id: 'channel', type: 'multi_select', label: 'Channel', options: CHANNELS },
    { id: 'region', type: 'multi_select', label: 'Region', options: ['North', 'South'] },
  ],
};

export const NO_JOB = {
  has_job: false, source: 'table', last_success: null, last_run: null, active: null, overdue: false, cadence_days: null, data_through: null,
  can_refresh: false, reason: 'The App does not refresh this page: it shows its tables as they are', run_url: '',
};

export const PERSON = ['pat.lee', 'example.com'].join('@');
export const OTHER = ['sam.roe', 'example.com'].join('@');
export const DECIDE = { options: { modify: false, replace_edits: false, decisions: true } };
export const LABEL = 'Item number 1 with a long descriptive name';
export const F = (name, kind, role = 'business', type = 'STRING') => ({ name, kind, role, type, editable: role === 'business' && kind != null });
export const FIELDS = [F('entity_id', 'text', 'id'), F('entity_label', 'text'), F('priority_tier', 'text'), F('rank', 'integer', 'business', 'INT'),
  F('recommended_action', 'text'), F('as_of_date', 'date', 'run', 'DATE'), F('record_key', 'text', 'history'),
  F('valid_from', 'timestamp', 'history', 'TIMESTAMP'), F('is_current', 'boolean', 'history', 'BOOLEAN'), F('change_source', 'text', 'history'),
  F('changed_by', 'text', 'history'), F('action_owner', 'text', 'action'), F('action_status', 'text', 'action'), F('action_due', 'date', 'action', 'DATE'),
  F('action_note', 'text', 'action'), F('dismiss_reason', 'text', 'action'), F('action_outcome', 'text', 'action')];
export const ROWS = pageData({}).records.rows.map((r, i) => ({ ...r, record_key: r.entity_id, _inspire_key: r.entity_id, _inspire_version: String(100 + i),
  _inspire_owner: i % 2 ? OTHER : null, _inspire_status: i % 2 ? 'In progress' : null, _inspire_change: i === 0 ? 'new' : i === 1 ? 'moved' : null,
  _inspire_moved_to: i === 1 ? 'Act now' : null }));
export const CURRENT = { ...ROWS[0], valid_from: '2026-10-20T09:00:00.000Z', is_current: true, change_source: 'run', changed_by: 'run 77', valid_from_us: '102',
  action_owner: PERSON, action_status: 'New', action_due: null, action_note: null, dismiss_reason: null, action_outcome: null };
export const HISTORY = { record_key: 'R001', fields: FIELDS, versions: [CURRENT], current: CURRENT, deleted: false, truncated: false };
export const SUMMARY = { open: 14, done: 9, resolved: 6, left: 12, owners: [OTHER, PERSON] };

export function lister(rows, extra = {}, total = null) {
  return ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const picked = typeof rows === 'function' ? rows(body) : rows.slice(body.offset, body.offset + body.limit);
    return json(200, { rows: picked, total: total ?? rows.length, offset: body.offset, limit: body.limit, actions: false, changes: false, summary: null,
      errors: {}, ...extra });
  };
}

export const REQUEST_IDS = [];

export function actBody(route) {
  const { request_id: id, ...body } = route.request().postDataJSON();
  if (!/^[0-9a-f]{32}$/.test(String(id))) throw new Error(`records/act was sent without a 32 hex request_id: ${JSON.stringify(id)}`);
  REQUEST_IDS.push(id);
  return body;
}

export function tracked(overrides = {}) {
  const calls = { acts: [], history: 0, fields: 0, undos: [], similar: [], batches: 0 };
  const routes = {
    records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY }),
    'records/fields': ({ json }) => { calls.fields += 1; return json(200, { fields: FIELDS, key_field: 'entity_id', actions: true }); },
    'records/history': ({ json }) => { calls.history += 1; return json(200, HISTORY); },
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      calls.acts.push(body);
      return json(200, { written: body.record_keys, conflicts: [] });
    },
    ...overrides,
  };
  return { calls, routes };
}

export const NO_HUB = { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', pages: {}, errors: {} };
export const NO_SUMMARY = { run: null, categories: {}, note: 'no run of this use case has written its summary yet' };
export const NO_MY_WORK = { person: '', period: { window: 'week', zone: 'UTC', today: '2026-10-24', start_day: '2026-10-19', end_day: '2026-10-26' }, errors: {}, offset: 0, size: 50, total: 0, pages: {}, activity: [] };
export const WORK_WEEK = NO_MY_WORK.period;
export const WORKED = { fixed: 2, dismissed: 1, could_not: 1, assigned: 1, notes: 1, changes: 9, records: 6 };
export const workMoney = (m, r, e) => ({ measured: { n: m ? 1 : 0, money: m }, reported: { n: r ? 1 : 0, money: r }, estimated: { n: e ? 2 : 0, money: e } });
export const WORK_TEAM = { closed: { fixed: 6, dismissed: 3, could_not: 1 }, total: 10, people: 3, close: { n: 10, median_hours: 60 } };
export const workEntry = (over = {}) => ({
  visible: true, tracked: true, priced: true, worked: WORKED, active_hours: 4, money: workMoney(900, 500, 3000), close: { n: 4, median_hours: 53 },
  best: { key: 'R002', label: 'Item R002', basis: 'measured', money: 900, closed: '2026-10-22T06:00:00Z' }, activity: [], minutes: null, served: 'delta',
  team: WORK_TEAM, weeks: [{ week: '2026-10-12', n: 1 }, { week: '2026-10-19', n: 3 }],
  outcomes: { left: 1, missing: 0, resolved: 1, flagged: 0, unchecked: 0 },
  overdue: { n: 3, items: [{ key: 'R001', label: 'Item R001', due: '2026-10-20' }, { key: 'R003', label: 'Item R003', due: '2026-10-22' }] }, ...over,
});
export const myWorkOf = (pageId, over = {}, activity = []) => ({ ...NO_MY_WORK, person: PERSON, pages: { [pageId]: workEntry(over) }, activity, total: activity.length });
export const isInboxAsk = (body) => !!body && (body.changed === true || ((body.mine === true || body.unowned === true) && body.window === 'all' && body.limit === INBOX_ROWS && !body.offset));
export const NO_RUNS = { runs: [], total: 0, offset: 0, limit: 20, job: null, errors: {} };
export const NO_TRENDS = { visible: true, tracked: true, actions: false, note: 'this use case keeps no actions, so it has no work of yours to show' };
export const NO_MONEY = { model: null, history: [], editable: false, why: 'this page puts no amount at stake on its records' };
export const NO_SETTINGS = { settings: [], history: [], editable: false, why: 'Only the owners of this use case can change its settings', can_run: false };
export const NO_IMPACT = { visible: true, tracked: false, empty: true, note: 'no run of this use case has written its results yet', promised: null };
export const NO_FEEDBACK = { items: [], everyone: false, missing: false, limit: 2000 };

export async function serveDist({ prefix = '/', headers = () => ({}) } = {}) {
  let origin = '';
  const server = createServer(async (req, res) => {
    const url = req.url.split('?')[0].split('#')[0];
    const path = url.startsWith(prefix) ? `/${url.slice(prefix.length)}` : '';
    try {
      const body = await readFile(join(DIST, path === '/' ? 'index.html' : path || 'missing'));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html', ...headers(origin) });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('missing');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { base: `${origin}${prefix}`, origin, close: () => server.close() };
}

const ANSWERING = new WeakMap();
const API_QUIET_MS = 200;

export async function steadyBox(page, locator, timeout = 15000) {
  await locator.waitFor({ timeout });
  const api = ANSWERING.get(page);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const box = await locator.evaluate((el) => new Promise((done) => {
      const read = () => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const first = read();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const next = read();
        done(Object.keys(first).every((k) => first[k] === next[k]) ? next : null);
      }));
    }));
    if (box && (!api || (api.open === 0 && Date.now() - api.at >= API_QUIET_MS))) return box;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${locator} did not stop moving in ${timeout} ms`);
}

export async function sent(page) {
  await page.evaluate(() => fetch('/api/__fence').then(() => undefined));
}

export async function idle(page, timeout = 15000) {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout });
  await sent(page);
  await until(() => (ANSWERING.get(page)?.open ?? 0) === 0, timeout);
}

export const framed = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

export const moved = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))));

export async function openApp(browser, base, info, { width = 1440, height = 900, scheme = 'light', errors = {}, routes = {}, clock, watch, ready = '.kpi-v, .hcard, [data-page-section]:not([data-page-section="dashboard"])',
  timezone, hash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, acceptDownloads: true, ...(timezone ? { timezoneId: timezone } : {}) });
  const page = await context.newPage();
  const seen = { pages: [], records: [], asks: [], errors: [] };
  page.on('pageerror', (e) => seen.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') seen.errors.push(m.text()); });
  if (watch) await watch(page);
  let polls = 0;
  const api = { open: 0, at: Date.now() };
  ANSWERING.set(page, api);
  const answer = async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*?\/api\//, '');
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '__fence') return route.fulfill({ status: 204 });
    if (routes[path]) return routes[path]({ route, json, url, seen });
    if (path === 'app') return json(200, info);
    if (path === 'filters') return json(200, FILTERS);
    if (path === 'defaults') return json(200, { range: null, errors: {} });
    if (path === 'freshness') return json(200, NO_JOB);
    if (path === 'overview') return json(200, NO_HUB);
    if (path === 'summary') return json(200, NO_SUMMARY);
    if (path === 'runs') return json(200, NO_RUNS);
    if (path === 'trends') return json(200, NO_TRENDS);
    if (path === 'money') return json(200, NO_MONEY);
    if (path === 'settings') return json(200, NO_SETTINGS);
    if (path === 'impact') return json(200, NO_IMPACT);
    if (path === 'my_work') return json(200, NO_MY_WORK);
    if (path === 'feedback') return json(200, NO_FEEDBACK);
    if (path === 'records/batches') return json(200, { ...CONTRACT.batches.response, batches: [] });
    if (path === 'agent/status') return json(200, GENIE_ONLY);
    if (path === 'page') {
      const body = route.request().postDataJSON();
      seen.pages.push(body);
      return json(200, { ...pageData(body.filters), errors });
    }
    if (path === 'records') {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const all = pageData(body.filters).records.rows;
      const offset = body.offset || 0;
      return json(200, { rows: all.slice(offset, offset + (body.limit || 25)), total: all.length, offset, limit: body.limit || 25, actions: false, changes: false, summary: null, errors: {} });
    }
    if (path === 'genie/ask') { seen.asks.push(route.request().postDataJSON()); polls = 0; return json(200, { conversation_id: 'c1', message_id: 'm1' }); }
    if (path === 'genie/message') {
      polls += 1;
      if (polls < 2) return json(200, { state: 'running', step: 'Writing the SQL' });
      const text = seen.asks.length > 1
        ? '### By channel\nOnline lost **more** than stores:\n- **Online**: `180,000`\n- **Stores**: `120,000`'
        : 'Books lost the most to discounts last quarter, about a third of the total.';
      return json(200, { state: 'done', text, sql: 'SELECT category, SUM(loss) FROM t GROUP BY 1',
        columns: [{ name: 'category', type: 'STRING' }, { name: 'loss', type: 'DOUBLE' }], rows: [{ category: 'Books', loss: 300000 }], truncated: false });
    }
    return json(404, { error: 'no route' });
  };
  await page.route('**/api/**', async (route) => {
    api.open += 1;
    try {
      return await answer(route);
    } finally {
      api.open -= 1;
      api.at = Date.now();
    }
  });
  if (clock) await page.clock.install({ time: clock });
  await page.goto(`${base}${hash}`);
  await page.waitForSelector(ready);
  return { page, seen, context };
}

export async function bundleEntry(code) {
  const entry = { name: 'test-entry', resolveId: (id) => (id === 'test-entry' ? '\0test-entry' : null), load: (id) => (id === '\0test-entry' ? code : null) };
  const out = await build({ root: SRC, configFile: false, logLevel: 'silent', plugins: [react(), entry],
    build: { write: false, minify: false, cssCodeSplit: false, rollupOptions: { input: 'test-entry', output: { format: 'iife', inlineDynamicImports: true } } } });
  const files = (Array.isArray(out) ? out[0] : out).output;
  return { js: files.find((o) => o.type === 'chunk').code, css: files.filter((o) => o.type === 'asset' && o.fileName.endsWith('.css')).map((o) => String(o.source)).join('\n') };
}

export async function openBundle(browser, bundle, props, routes = {}, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\//, '');
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '__fence') return route.fulfill({ status: 204 });
    if (routes[path]) return routes[path]({ route, json });
    if (path === 'agent/status') return json(200, GENIE_ONLY);
    return json(404, { error: 'no route' });
  });
  const html = `<!doctype html><html><head><style>${bundle.css}</style></head><body><div id="root"></div>`
    + `<script>window.props = ${JSON.stringify(props)};</script><script>${bundle.js}</script></body></html>`;
  await page.route('http://bundle.test/', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('http://bundle.test/');
  return { page, context, errors };
}

export const ASK_GROUPS = {
  card: '[data-card], [data-bars], section.card--table, section.money, .main .card:has(> .card-h)',
  kpi: '.kpi',
  text: '.story, .blk--text, .blk--html, .sum',
  controls: '.fbar',
  row: '.main tbody tr, .main .choice-row',
  group: '.main .rec-entity',
};

export function askAudit(groups) {
  const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && el.getBoundingClientRect().width > 0
    && el.getBoundingClientRect().height > 0;
  const own = (el) => (el.matches(groups.card) ? el.querySelector(':scope > :is(header, .money-h) .ask-genie') : el.querySelector('.ask-genie, .row-ask'));
  const all = Object.values(groups).join(', ');
  const asks = (el) => [...el.querySelectorAll('.ask-genie, .row-ask, button')]
    .filter((b) => (b.matches('.ask-genie, .row-ask') || /^Ask Genie\b/.test(b.textContent.trim())) && !b.parentElement.closest('.ask-genie, .row-ask'))
    .filter((b) => b.closest(all) === el && shown(b));
  const out = { counts: {}, missing: [], hidden: [], doubled: [] };
  Object.entries(groups).forEach(([group, selector]) => {
    const items = [...document.querySelectorAll(selector)].filter((el) => shown(el) && !(el.matches('tr') && el.querySelectorAll('td').length < 2));
    out.counts[group] = items.length;
    items.forEach((el) => {
      const name = el.getAttribute('aria-label') || el.dataset.card || el.dataset.bars || el.className;
      const ask = own(el);
      if (asks(el).length > 1) out.doubled.push(`${group}: ${name}`);
      if (!ask) out.missing.push(`${group}: ${name}`);
      else if (!shown(ask)) out.hidden.push(`${group}: ${name}`);
    });
  });
  return out;
}

export async function footerActions(scope) {
  const more = scope.locator('.panel-f > [data-act=more]');
  if (await more.count() && (await more.getAttribute('aria-expanded')) === 'false') await more.click();
  return (await scope.locator('.panel-f > button:not([data-act=more])').allInnerTexts()).sort();
}
