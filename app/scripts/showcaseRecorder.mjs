import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SHOWCASE_BUTTON } from '../frontend/src/lib/showcase.js';
import { APP_TABS } from '../frontend/src/lib/tabs.js';
import { RUN_BACK } from '../frontend/src/lib/runPages.js';

const require = createRequire(import.meta.url);
const { SHOWCASE_GENIE_ASK, SHOWCASE_HEADER, SHOWCASE_READ_ONLY, showcaseCanRead } = require('../backend/lib/showcase.js');
const { demoView } = require('../backend/lib/showcaseRecord.js');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};
const REAL_KEYS = ['inspire_database', 'warehouse_id'];
const GENIE_WAIT_MS = 180000;
export const BUILD_PANELS = ['Settings', 'Target KPI', 'Build and job', 'Run and schedule', 'History', 'Alerts of this use case'];

export function apiWatch(page) {
  let inflight = 0;
  let last = Date.now();
  const mine = (request) => new URL(request.url()).pathname.includes('/api/');
  page.on('request', (r) => { if (mine(r)) { inflight += 1; last = Date.now(); } });
  const done = (r) => { if (mine(r)) { inflight = Math.max(0, inflight - 1); last = Date.now(); } };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async ({ quiet = 1500, max = 90000 } = {}) => {
    const end = Date.now() + max;
    while (Date.now() < end) {
      if (inflight === 0 && Date.now() - last >= quiet) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };
}

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export async function keepToOrigins(context, origins, refused) {
  await context.route((u) => !origins.has(u.origin), (route) => {
    refused.push(route.request().url());
    return route.abort('internetdisconnected');
  });
}

function initiatorText(initiator) {
  if (!initiator) return '';
  const frame = initiator.stack && Array.isArray(initiator.stack.callFrames) ? initiator.stack.callFrames[0] : null;
  if (frame) return `${initiator.type} ${frame.url}:${frame.lineNumber + 1}`;
  return `${initiator.type}${initiator.url ? ` ${initiator.url}` : ''}${Number.isInteger(initiator.lineNumber) ? `:${initiator.lineNumber + 1}` : ''}`;
}

export async function watchOffline(context, origins) {
  const found = { outside: [], pageErrors: [], consoleErrors: [], blocked: [] };
  const initiators = new Map();
  let where = 'start';
  const attached = new WeakMap();
  const attach = async (page) => {
    page.on('pageerror', (e) => found.pageErrors.push({ page: where, error: String(e.message).split('\n')[0].slice(0, 300) }));
    page.on('console', (m) => { if (m.type() === 'error') found.consoleErrors.push({ page: where, error: m.text().slice(0, 300) }); });
    const cdp = await context.newCDPSession(page).catch(() => null);
    if (!cdp) return;
    cdp.on('Network.requestWillBeSent', (e) => { if (!initiators.has(e.request.url)) initiators.set(e.request.url, initiatorText(e.initiator)); });
    await cdp.send('Network.enable').catch(() => null);
  };
  const watch = (page) => {
    if (!attached.has(page)) attached.set(page, attach(page));
    return attached.get(page);
  };
  context.on('page', (page) => { watch(page); });
  const open = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await open(...args);
    await watch(page);
    return page;
  };
  await keepToOrigins(context, origins, { push: (url) => found.outside.push({ page: where, url }) });
  return {
    found,
    at: (label) => { where = label; },
    report: () => ({
      ...found,
      outside: found.outside.map((o) => {
        const u = new URL(o.url);
        return { page: o.page, host: u.host, path: u.pathname, initiator: initiators.get(o.url) || '' };
      }),
    }),
  };
}

export async function readOnlyInspire(page, origin, blocked, reads = new Set()) {
  await page.route((u) => u.origin === origin && u.pathname.startsWith('/api/'), (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    const read = reads.has(key) || (showcaseCanRead(request.method(), pathname) && key !== SHOWCASE_GENIE_ASK);
    if (!read) return refuse(route, blocked, request.method(), pathname);
    return route.continue();
  });
}

function refuse(route, blocked, method, pathname) {
  blocked.push(`${method} ${pathname}`);
  return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: SHOWCASE_READ_ONLY, showcase: true }) });
}

async function passOn(route, exchanges, { url, headers, postData }, shape = (body) => body) {
  const request = route.request();
  const response = await route.fetch({ url, method: request.method(), headers, postData });
  const text = await response.text();
  const type = response.headers()['content-type'] || '';
  const plain = Boolean(type) && !/json/i.test(type);
  const got = parsed(text);
  const body = plain ? text : response.status() < 300 ? shape(got) : got;
  exchanges.push({
    method: request.method(), url: request.url(), postData: request.postData() || undefined, status: response.status(),
    body, ...(plain ? { type } : {}), ...(!plain && text !== '' && got === text ? { unparsed: true } : {}),
  });
  return route.fulfill({ response, body: plain || body === got ? text : JSON.stringify(body) });
}

function withReal(url, postData, real) {
  const target = new URL(url);
  for (const k of REAL_KEYS) if (target.searchParams.has(k)) target.searchParams.set(k, real[k]);
  if (!postData) return { url: target.toString(), postData: undefined };
  const body = parsed(postData);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const k of REAL_KEYS) if (k in body) body[k] = real[k];
    return { url: target.toString(), postData: JSON.stringify(body) };
  }
  return { url: target.toString(), postData };
}

function serveDist(route, distDir, pathname) {
  const root = path.resolve(distDir);
  const file = path.resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
  const found = file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(found)] || 'application/octet-stream', body: fs.readFileSync(found) });
}

export async function routeInspireDemo(page, { origin, distDir = '', summary, real, authHeaders = {}, exchanges, blocked }) {
  for (const k of REAL_KEYS) if (!real[k]) throw new Error(`the Inspire App has no ${k}, so the demo cannot be recorded`);
  await page.route((u) => u.origin === origin, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/showcase') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ showcases: [summary] }) });
    }
    if (url.pathname.startsWith('/api/')) {
      const { [SHOWCASE_HEADER]: demo, ...headers } = request.headers();
      if (!demo) return route.continue({ headers: { ...headers, ...authHeaders } });
      if (!showcaseCanRead(request.method(), url.pathname)) return refuse(route, blocked, request.method(), url.pathname);
      return passOn(route, exchanges, { ...withReal(request.url(), request.postData(), real), headers: { ...headers, ...authHeaders } },
        (body) => demoView(request.method(), request.url(), body, summary.session_id));
    }
    return distDir ? serveDist(route, distDir, url.pathname) : route.continue();
  });
}

export async function expandBuild(page) {
  const progress = page.locator('[data-mvp-progress]');
  await progress.waitFor({ timeout: 15000 });
  if (await progress.getAttribute('data-progress-open') === 'false') await progress.locator('[data-progress-toggle]').click();
  await page.locator('[data-mvp-progress][data-progress-open="true"]').waitFor({ timeout: 15000 });
}

export async function walkMvpViews(page, settle, visit = async () => {}) {
  const progress = page.locator('[data-mvp-progress]');
  if (!(await progress.count())) return [];
  await settle();
  await expandBuild(page);
  await visit('build', progress);
  const seen = ['build'];
  const ids = await page.locator('[data-asset-tiles] [data-asset-tile]')
    .evaluateAll((tiles) => tiles.filter((tile) => tile.querySelector('[data-tile-versions]')).map((tile) => tile.dataset.assetTile));
  for (const id of ids) {
    await page.locator(`[data-asset-tile="${id}"] [data-tile-versions]`).click();
    const panel = page.locator(`[data-mvp-panel="${id}"]`);
    await panel.waitFor();
    await settle();
    await visit(id, panel);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    seen.push(id);
  }
  return seen;
}

export function tabButton(page, id) {
  const { label } = APP_TABS.find((tab) => tab.id === id);
  return page.locator('header nav button').filter({ hasText: new RegExp(`${label}$`) });
}

async function openTab(page, settle, id) {
  await tabButton(page, id).click();
  await settle();
}

async function walkReviewRuns(page, settle) {
  await page.getByRole('button', { name: 'Change run', exact: true }).click();
  const runs = page.getByRole('group', { name: 'Runs' }).locator('button[data-run]');
  await runs.first().waitFor({ timeout: 120000 });
  await settle();
  const n = await runs.count();
  for (let i = n - 1; i >= 0; i -= 1) {
    await runs.nth(i).click();
    await settle();
    if (i > 0) await page.getByRole('button', { name: 'Change run', exact: true }).click();
  }
  return n;
}

async function walkStart(page, settle) {
  await openTab(page, settle, 'choose');
  const rows = page.locator('main [data-run]');
  await rows.first().waitFor({ timeout: 120000 });
  await settle();
  const quick = page.locator('main button[title="Quick view use cases"]');
  const q = await quick.count();
  for (let i = 0; i < q; i += 1) {
    await quick.nth(i).click();
    await settle();
    await quick.nth(i).click();
    await settle();
  }
  const totals = await page.locator('main [data-portfolio] [data-portfolio-card]').count();
  const cards = page.locator('main button[data-portfolio-card]');
  const keys = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-portfolio-card')));
  for (const key of keys) {
    const card = page.locator(`main button[data-portfolio-card="${key}"]`);
    const filters = (await card.getAttribute('aria-pressed')) !== null;
    await card.click();
    if (filters) {
      await page.locator(`main [data-run-filter="${key}"]`).waitFor();
      await settle();
    } else {
      await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
      await settle();
      await openTab(page, settle, 'choose');
      await rows.first().waitFor();
      await page.locator('main [data-portfolio] [data-card-value] [aria-label="Loading"]').first().waitFor({ state: 'detached' });
      await settle();
    }
  }
  return { runs: await rows.count(), quick: q, totals, cards: keys };
}

async function walkMonitor(page, settle) {
  await openTab(page, settle, 'monitor');
  await page.getByRole('heading', { name: 'Pipeline Monitor' }).waitFor({ timeout: 120000 });
  await settle();
  const steps = page.getByRole('heading', { name: 'Detailed Steps' });
  const shown = await steps.count();
  const usecases = page.getByRole('button', { name: 'Show the use cases' });
  if (await usecases.count()) {
    await usecases.click();
    await settle();
  }
  return { steps: shown > 0 };
}

export async function walkRun(page, settle, onPage = null) {
  await openTab(page, settle, 'run');
  const list = page.locator('[data-run-page-root]');
  await list.waitFor({ timeout: 120000 });
  await settle();
  const pages = page.locator('[data-run-page]');
  const n = await pages.count();
  for (let i = 0; i < n; i += 1) {
    await pages.nth(i).click();
    await settle();
    if (onPage) await onPage(i);
    if (!(await page.locator('[data-run-full]').count())) continue;
    const toggle = page.locator('[data-run-control-toggle]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.getByRole('button', { name: RUN_BACK, exact: true }).click();
    await list.waitFor({ timeout: 120000 });
    await settle();
  }
  return n;
}

export async function walkInspireDemo(page, { settle, log = () => {}, mvps = true }) {
  await page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().click();
  const list = page.getByRole('region', { name: 'Use case list' });
  const cards = list.locator('[aria-expanded]');
  await cards.first().waitFor({ timeout: 180000 });
  await settle();
  const runs = await walkReviewRuns(page, settle);
  log(`Review: opened ${runs} run cards`);
  await cards.first().waitFor({ timeout: 180000 });
  const n = await cards.count();
  for (let i = 0; i < n; i += 1) {
    await cards.nth(i).click();
    await settle();
  }
  log(`Review: opened ${n} use cases`);
  const open = list.getByRole('button', { name: 'Open MVP' });
  if (await open.count()) await open.first().click();
  else if (mvps) throw new Error('the demo session has no MVP on the Review page');
  else await tabButton(page, 'implement').click();
  const rail = page.locator('nav[aria-label="Use cases"] section button');
  await rail.first().waitFor({ timeout: 120000 });
  await settle();
  const m = await rail.count();
  const build = [];
  for (let i = 0; i < m; i += 1) {
    await rail.nth(i).click();
    await settle();
    const name = (await page.locator('[data-pinned-name] h2').textContent()).trim();
    const panels = new Set();
    const tabs = await walkMvpViews(page, settle, async () => {
      for (const region of BUILD_PANELS) if (await page.getByRole('region', { name: region, exact: true }).count()) panels.add(region);
    });
    if (tabs.length) log(`Build: ${name}: ${tabs.join(', ')}${panels.size ? `; panels ${[...panels].join(', ')}` : ''}`);
    build.push({ name, tabs, panels: [...panels] });
    const details = page.getByRole('button', { name: 'Use case details' });
    if (await details.count()) {
      await details.first().click();
      await settle();
      await page.keyboard.press('Escape');
      await settle();
    }
  }
  log(`Build: opened ${m} use cases`);
  const run = await walkRun(page, settle);
  log(`Run: opened ${run} MVP Apps`);
  const start = await walkStart(page, settle);
  log(`Start: ${start.runs} runs, ${start.quick} quick views, ${start.totals} totals, ${start.cards.length} cards${start.cards.length ? ` (${start.cards.join(', ')})` : ''}`);
  const monitor = await walkMonitor(page, settle);
  log(`Monitor: ${monitor.steps ? 'the steps of the run' : 'no steps'}`);
  return { results: n, runs, build, run, start, monitor, tabs: ['results', 'implement', 'run', 'choose', 'monitor'] };
}

async function askEach(page, settle, buttons, max, log, where) {
  let asked = 0;
  for (let i = 0; i < max; i += 1) {
    const button = page.locator(buttons).nth(i);
    if (!(await button.count())) break;
    const question = (await button.innerText()).trim();
    await button.click();
    await page.waitForFunction(() => document.querySelectorAll('.msg--genie').length > 0
      && !document.querySelector('.msg--genie .g-step'), null, { timeout: GENIE_WAIT_MS });
    await settle();
    asked += 1;
    log(`${where}: Genie answered "${question.slice(0, 80)}"`);
    const fresh = page.locator('.genie .g-h button.link', { hasText: 'New chat' });
    if (await fresh.count()) {
      await fresh.click();
      await settle();
    }
  }
  return asked;
}

export function screenOf(page) {
  return page.evaluate(() => {
    const route = location.hash.split('?')[0].split('/').slice(0, 2).join('/');
    if (route.length > 2) return `${location.pathname}${route}`;
    const heading = document.querySelector('main h1, h1');
    return `${location.pathname}|${heading ? heading.textContent.trim() : ''}`;
  });
}

async function walkScreen(page, settle, { rows, questions, log, where, home, goBack = async () => {} }) {
  const views = page.locator('nav.views [role="tab"]');
  const back = async (view = -1) => {
    if ((await screenOf(page)) === home) return false;
    await goBack();
    await settle();
    if (view >= 0 && (await views.count()) > view) {
      await views.nth(view).click();
      await settle();
    }
    const now = await screenOf(page);
    if (now !== home) throw new Error(`${where}: the walk left the screen ${home} and could not return to it, it shows ${now}`);
    return true;
  };
  const v = Math.max(1, await views.count());
  for (let i = 0; i < v; i += 1) {
    if (await views.count()) {
      await views.nth(i).click();
      await settle();
      await back();
    }
    const clickable = page.locator('table.tbl tbody tr.is-click');
    const r = Math.min(rows, await clickable.count());
    for (let j = 0; j < r; j += 1) {
      await clickable.nth(j).click();
      await settle();
      await page.keyboard.press('Escape');
      await settle();
      await back((await views.count()) ? i : -1);
    }
  }
  const pickers = page.locator('.fbar button.msel');
  const p = Math.min(4, await pickers.count());
  for (let i = 0; i < p; i += 1) {
    await pickers.nth(i).click();
    const option = page.locator('.msel-pop .opt input').first();
    if (await option.count()) {
      await option.check();
      await settle();
    }
    await page.keyboard.press('Escape');
    await back();
    const clear = page.locator('.fbar button.link', { hasText: 'Clear filters' });
    if (await clear.count()) {
      await clear.click();
      await settle();
      await back();
    }
  }
  const selects = page.locator('.fbar select');
  const s = await selects.count();
  for (let i = 0; i < s; i += 1) {
    const values = await selects.nth(i).locator('option').evaluateAll((os) => os.map((o) => o.value));
    for (const value of values.filter((x) => x !== 'custom').slice(1, 4)) {
      await selects.nth(i).selectOption(value);
      await settle();
      await back();
    }
    if (values.length) {
      await selects.nth(i).selectOption(values[0]);
      await settle();
      await back();
    }
  }
  const genie = page.locator('header.top button.genie-btn');
  if (questions && (await genie.count())) {
    if ((await genie.getAttribute('aria-expanded')) !== 'true') await genie.click();
    await askEach(page, settle, '.genie .g-sugg button.sugg', questions, log, where);
    const rowAsk = page.locator('table.tbl tbody button.row-ask').first();
    if (await rowAsk.count()) {
      await rowAsk.click();
      await settle();
      await askEach(page, settle, '.genie .g-sugg[aria-label^="Questions about"] button.sugg', 1, log, `${where} record`);
    }
    const close = page.locator('.genie button[aria-label="Close Ask Genie"]');
    if (await close.count()) await close.click();
    await back();
  }
  for (let i = 0; questions && i < v; i += 1) {
    if (await views.count()) {
      await views.nth(i).click();
      await settle();
    }
    const chips = await page.locator('[data-question]').count();
    if (chips) {
      await askEach(page, settle, '[data-question]', chips, log, `${where} chat`);
      const fresh = page.locator('button.link', { hasText: 'New chat' });
      if (await fresh.count()) {
        await fresh.first().click();
        await settle();
      }
      await back((await views.count()) ? i : -1);
    }
  }
}

export async function recordMvpApp(context, { url, authHeaders = {}, exchanges, blocked, log = () => {}, rows = 2, questions = 4 }) {
  const page = await context.newPage();
  const origin = new URL(url).origin;
  await page.route((u) => u.origin === origin && u.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (!showcaseCanRead(request.method(), pathname)) return refuse(route, blocked, request.method(), pathname);
    return passOn(route, exchanges, { url: request.url(), headers: { ...request.headers(), ...authHeaders }, postData: request.postData() || undefined });
  });
  const settle = apiWatch(page);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('.app').waitFor({ timeout: 120000 });
    await settle();
    const nav = page.locator('nav.side button');
    const n = await nav.count();
    for (let i = 0; i < n; i += 1) {
      const title = (await nav.nth(i).innerText()).split('\n')[0].trim();
      const here = nav.nth(i);
      await here.click();
      await page.waitForFunction((at) => document.querySelectorAll('nav.side button')[at]?.getAttribute('aria-current') === 'page', i, { timeout: 30000 });
      await settle();
      const shared = ['Overview', 'Impact'].includes(title);
      const hash = await page.evaluate(() => location.hash);
      const goBack = () => page.evaluate((h) => { location.hash = h; }, hash);
      await walkScreen(page, settle, { rows, questions: shared ? 0 : questions, log, where: title, home: await screenOf(page), goBack });
    }
    log(`MVP App ${origin}: walked ${n} screens`);
  } finally {
    await page.close();
  }
}
