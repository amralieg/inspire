import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { expandBuild } from '../../../scripts/showcaseRecorder.mjs';
import { ASSET_FILTER_STORAGE } from '../../src/lib/implementControl.js';

export { expandBuild };

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { makeApp } = createRequire(import.meta.url)('../../../backend/test/support/implementApp.js');
export const CURRENT_BUILD = createRequire(import.meta.url)('../../../backend/lib/appShell.js').bundledBuildStamp();
const UNKNOWN_BUILD = { version: '', shell: '' };

export const PREBUNDLED_ENV = 'INSPIRE_UI_PREBUNDLED';

export function viteOptions(cacheDir) {
  return { root: frontend, configFile: path.join(frontend, 'vite.config.js'), cacheDir, logLevel: 'error', clearScreen: false };
}

export const VITE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-ui-vite-'));
process.once('exit', () => fs.rmSync(VITE_CACHE_DIR, { recursive: true, force: true }));
const prebundled = process.env[PREBUNDLED_ENV] ? path.join(process.env[PREBUNDLED_ENV], 'deps') : '';
if (prebundled && fs.existsSync(path.join(prebundled, '_metadata.json'))) fs.cpSync(prebundled, path.join(VITE_CACHE_DIR, 'deps'), { recursive: true });

let browser;
let servers = null;
let lastUi = 0;
const backends = new Map();
export const UI_HEADER = 'x-inspire-ui-test';

function backendFor(id) {
  if (id !== undefined) return backends.get(String(id)) || null;
  return backends.size === 1 ? [...backends.values()][0] : null;
}

function dispatch(req, res) {
  const id = req.headers[UI_HEADER];
  delete req.headers[UI_HEADER];
  const app = backendFor(id);
  if (app) return app(req, res);
  res.statusCode = 503;
  res.end(id === undefined ? `a request without ${UI_HEADER} reached ${backends.size} open UI tests` : `no open UI test ${id}`);
}

async function startServers() {
  const backend = http.createServer(dispatch);
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${backend.address().port}`;
  try {
    const vite = await createServer({
      ...viteOptions(VITE_CACHE_DIR),
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': url, '/showcase': url, '/run': url }, hmr: false },
    });
    try {
      await vite.listen();
    } catch (e) {
      await vite.close();
      throw e;
    }
    return { backend, vite, origin: `http://127.0.0.1:${vite.httpServer.address().port}` };
  } catch (e) {
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
    throw e;
  }
}

function sharedServers() {
  if (!servers) servers = startServers().catch((e) => { servers = null; throw e; });
  return servers;
}

export async function closeBrowser() {
  const started = servers;
  servers = null;
  if (browser) await browser.close();
  browser = null;
  const up = started && await started.catch(() => null);
  if (!up) return;
  await up.vite.close();
  up.backend.closeAllConnections();
  await new Promise((resolve) => up.backend.close(resolve));
}

const ASKING = new WeakMap();

export async function idle(page, { held = () => false, timeout = 15000 } = {}) {
  await page.evaluate(() => fetch(location.pathname, { method: 'HEAD', cache: 'no-store' }).then(() => undefined));
  const asking = ASKING.get(page);
  if (asking) await until(() => [...asking].every(held), 'every ask the page sent is answered', timeout);
  await painted(page);
}

export async function openUi(open, overrides = {}, query = '', { mount, init } = {}) {
  if (!browser) browser = await chromium.launch();
  const made = makeApp({ useCase: HARNESS_USE_CASE, buildStamp: UNKNOWN_BUILD, ...overrides }, { mount });
  const opened = [];
  const close = async () => {
    const failed = [];
    for (const stop of opened.splice(0).reverse()) await stop().catch((e) => failed.push(e));
    if (failed.length) throw failed[0];
  };
  try {
    const id = String(++lastUi);
    backends.set(id, made.app);
    opened.push(async () => { backends.delete(id); });
    const { origin } = await sharedServers();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { [UI_HEADER]: id } });
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('inspire.ui_fresh_page')) return;
      sessionStorage.setItem('inspire.ui_fresh_page', '1');
      localStorage.removeItem(key);
    }, ASSET_FILTER_STORAGE);
    opened.push(async () => { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); });
    const asking = new Set();
    ASKING.set(page, asking);
    page.on('request', (r) => asking.add(r));
    for (const done of ['requestfinished', 'requestfailed']) page.on(done, (r) => asking.delete(r));
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      for (const r of asking) if (!r.isNavigationRequest()) asking.delete(r);
    });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
    if (init) await init(page, origin);
    const firstData = open === 'implement' ? page.waitForResponse((r) => r.url().includes('/api/inspire/implement/status'), { timeout: 20000 }).catch(() => null) : null;
    await page.goto(`${origin}/test/ui/implement.html?open=${open}${query}`);
    await firstData;
    return { made, page, pageErrors, origin, close };
  } catch (e) {
    await close().catch(() => null);
    throw e;
  }
}

export async function openBuild(state, { init } = {}) {
  const ui = await openUi('implement', state, '', { init });
  try {
    await expandBuild(ui.page);
    return ui;
  } catch (e) {
    await ui.close();
    throw e;
  }
}

export async function closeBuild(page) {
  const panel = page.locator('[data-progress-panel]');
  if (!(await panel.count())) return;
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
}

export async function openAsset(page, id) {
  const drawer = page.locator(`[data-mvp-panel="${id}"]`);
  if (await drawer.count()) return drawer;
  await closeBuild(page);
  if (await page.locator('[data-mvp-panel]').count()) await closeAsset(page);
  await page.locator(`[data-asset-tile="${id}"] [data-tile-versions]`).click();
  await drawer.waitFor({ timeout: 15000 });
  return drawer;
}

export async function closeAsset(page) {
  await page.keyboard.press('Escape');
  await page.locator('[data-mvp-panel], [data-vibe-features-dialog]').first().waitFor({ state: 'detached' });
}

export async function openFeatures(page) {
  const dialog = page.locator('[data-vibe-features-dialog]');
  if (await dialog.count()) return dialog;
  await closeBuild(page);
  if (await page.locator('[data-mvp-panel]').count()) await closeAsset(page);
  await page.locator('[data-vibe-features]').click();
  await dialog.waitFor({ timeout: 15000 });
  return dialog;
}

export const featuresBox = (page) => page.locator('[data-vibe-features-dialog] [data-vibe-box="mvp"]');
export const featuresText = (page) => featuresBox(page).getByRole('textbox', { name: 'Vibes for the MVP', exact: true });
export const featuresHeld = (page, label) => page.locator('[data-vibe-features-dialog]').getByRole('list', { name: `Asks the ${label} holds`, exact: true })
  .locator('[data-held-ask]').evaluateAll((items) => items.map((li) => [li.dataset.heldAsk, li.querySelector('span').textContent]));

export async function openSettings(page) {
  const dialog = await openFeatures(page);
  await dialog.getByRole('button', { name: 'Need more than words? Open all settings', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await onStep(page, 'Vibes');
  return page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ });
}

export const FAKE_CLOCK = { init: (page) => page.clock.install() };

export async function holdClock(page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

export async function watchScrolls(page) {
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
  return () => page.evaluate(() => window.__scrolls.splice(0));
}

export async function steadyBox(locator, { loaded = false, timeout = 15000 } = {}) {
  const end = Date.now() + timeout;
  await locator.waitFor({ state: 'attached', timeout });
  while (Date.now() < end) {
    const box = await locator.evaluate((el, skeletons) => new Promise((done) => {
      if (skeletons && el.querySelector('.animate-pulse')) {
        done(null);
        return;
      }
      const read = () => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height, el.scrollHeight, el.scrollWidth, el.scrollTop, el.scrollLeft];
      };
      const first = read();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const next = read();
        done(next.every((v, i) => v === first[i]) ? { x: next[0], y: next[1], width: next[2], height: next[3] } : null);
      }));
    }), loaded);
    if (box) return box;
  }
  throw new Error(`the layout of ${locator} did not settle in ${timeout} ms`);
}

export async function finiteAnimationsDone(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => null))));
}

export async function pollNow(page, route = '/api/inspire/implement/status', every = 10000) {
  const asked = page.waitForRequest((r) => r.url().includes(route), { timeout: 15000 });
  await page.clock.fastForward(every);
  const request = await asked;
  await request.response();
}

const STEP_HOLDING = {
  'Use case': 'Data & results', Data: 'Data & results', Results: 'Data & results', Summary: 'Review & build', 'What to build': 'What to deliver', Delivery: 'What to deliver', App: 'Where it lives', 'App placement': 'Where it lives', 'App access': 'Where it lives',
  'App features': 'Where it lives', 'App pages': 'Where it lives', 'App look': 'Where it lives', 'Who uses the App': 'Where it lives', 'Page storage': 'Where it lives', Measure: 'Measure', 'Keep it fresh': 'Data & results', Vibes: 'Review & build',
};
const exactly = (label) => {
  const body = label === 'Data & results' ? 'Data(?: & results)?' : label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(\\d+\\.\\s*)?${body}\\s*$`);
};
const isStep = (text, label) => exactly(label).test(text);

export function stepHolding(part) {
  return STEP_HOLDING[part] || part;
}

export async function onStep(page, part) {
  const label = stepHolding(part);
  try {
    await page.locator('[aria-current="step"]', { hasText: exactly(label) }).waitFor({ timeout: 15000 });
  } catch (e) {
    const shown = await page.locator('[role="alert"] p').allTextContents();
    throw new Error(`the wizard did not reach "${label}": ${shown.join(' | ') || e.message}`);
  }
}

export async function stepsAre(page, expected) {
  const want = expected.join('\n');
  try {
    await page.waitForFunction((w) => [...document.querySelectorAll('[data-wizard-header] ol li')].map((li) => li.textContent).join('\n') === w,
      want, { timeout: 15000 });
  } catch {
    assert.deepEqual(await page.locator('[data-wizard-header] ol li').allTextContents(), expected);
  }
}

export async function openAdvanced(page, what = 'data settings') {
  await page.getByRole('button', { name: `Change ${what}`, exact: true }).click();
}

export async function openRow(page, what) {
  const row = page.getByRole('button', { name: `Change ${what}`, exact: true });
  if (await row.count()) await row.click();
}

export async function openFolded(page, what) {
  const change = page.getByRole('button', { name: `Change ${what}`, exact: true });
  if (await change.count()) await change.click();
}

export async function openAllRows(page) {
  const closed = page.locator('[data-wizard-body] button[aria-expanded="false"][aria-label^="Change "]:not([data-fold-open])');
  for (let i = 0; i < 20 && await closed.count(); i += 1) await closed.first().click();
}

export const BUILD_IT = 'All Good, Build it Now';

export async function dataToResults(page) {
  await nextUntil(page, 'Results');
}

export async function toAppAccess(page) {
  await goToStep(page, 'App placement');
  await page.getByText('Finding the Apps Inspire built').waitFor({ state: 'detached' });
  await goToStep(page, 'App access');
}

export async function toSharedAccess(page) {
  await toAppAccess(page);
  await page.getByRole('region', { name: 'App access' }).getByRole('radio', { name: /^Internal data/ }).check();
}

export async function toVibes(page) {
  await nextUntil(page, 'Vibes');
}

export async function toSummary(page) {
  await nextUntil(page, 'Review & build');
}

export async function goToStep(page, part) {
  const label = stepHolding(part);
  const current = page.locator('[aria-current="step"]');
  await current.waitFor({ timeout: 15000 });
  const labels = await page.locator('[data-wizard-header] ol li').allTextContents();
  const target = labels.findIndex((l) => isStep(l, label));
  const now = (await current.innerText()).trim();
  const at = labels.findIndex((l) => l.trim() === now);
  if (target < 0) throw new Error(`the wizard has no "${label}" step: ${labels.join(' | ')}`);
  if (target >= at) return nextUntil(page, label);
  for (let i = 0; i < 30 && !isStep(await current.innerText(), label); i += 1) await page.getByRole('button', { name: 'Back', exact: true }).click();
  await onStep(page, label);
}

export async function nextUntil(page, part) {
  const label = stepHolding(part);
  const current = page.locator('[aria-current="step"]');
  await current.waitFor({ timeout: 15000 });
  const steps = page.locator('[data-wizard-header] ol li');
  for (let i = 0; i < 30 && !isStep(await current.innerText(), label); i += 1) {
    const moneyNext = page.locator('[data-money-next]');
    if (await moneyNext.count() && await moneyNext.isVisible()) { await moneyNext.click(); continue; }
    const from = await current.innerText();
    await page.getByRole('button', { name: 'Next' }).click({ timeout: 15000 });
    try {
      await page.waitForFunction((was) => document.querySelector('[aria-current="step"]')?.innerText !== was, from, { timeout: 15000 });
    } catch (e) {
      const shown = await page.locator('[role="alert"] p').allTextContents();
      throw new Error(`Next did not leave "${from}": ${shown.join(' | ') || e.message}`);
    }
  }
  await onStep(page, label);
}

export async function startMvp(page) {
  await toSummary(page);
  await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled),
    BUILD_IT, { timeout: 15000 });
  await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
}

export function settled(page, selector, { loaded = false, timeout = 15000 } = {}) {
  return steadyBox(page.locator(selector).first(), { loaded, timeout });
}

export async function shot(page, name, fullPage = true) {
  const dir = process.env.PAGE_SHOTS || '';
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await painted(page);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage });
}

export async function painted(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

export async function setDark(page, dark) {
  await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => null))));
}

export async function wizardFit(page) {
  await settled(page, '[role="dialog"]', { loaded: true });
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect();
    const body = document.querySelector('[data-wizard-body]');
    return { top: dialog.top, bottom: dialog.bottom, height: Math.round(dialog.height), scroll: body.scrollHeight, client: body.clientHeight,
      page: document.scrollingElement.scrollHeight };
  });
}

export function assertFitsScreen(fit, name, height = 900) {
  assert.ok(fit.top >= 0 && fit.bottom <= height, `${name}: the dialog sits inside the screen ${JSON.stringify(fit)}`);
  assert.ok(fit.scroll <= fit.client + 1, `${name}: the step needs no scroll (${fit.scroll} > ${fit.client})`);
  assert.ok(fit.page <= height, `${name}: the page itself does not scroll (${fit.page})`);
  return fit;
}

export async function wizardFits(page, name) {
  return assertFitsScreen(await wizardFit(page), name);
}

export async function wizardInScreen(page, name, height = 900) {
  const fit = await wizardFit(page);
  assert.ok(fit.top >= 0 && fit.bottom <= height, `${name}: the dialog sits inside the screen ${JSON.stringify(fit)}`);
  assert.ok(fit.page <= height, `${name}: only the step scrolls, never the page (${fit.page})`);
  return fit;
}

export async function clippedExamples(page, boxes) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const count = await boxes.count();
  if (!count) throw new Error('no vibes box to check');
  const clipped = [];
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    const example = await box.getAttribute('placeholder');
    if (!example) throw new Error(`${await box.getAttribute('aria-label')} has no gray example`);
    await box.fill(example);
    const size = await box.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    if (size.scroll > size.client + 1) clipped.push(`${await box.getAttribute('aria-label')}: ${size.scroll}px of text in ${size.client}px`);
    await box.fill('');
  }
  return clipped;
}

export async function until(check, what, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export function watchAsks(page, pick = () => true) {
  const sent = [];
  const open = new Set();
  page.on('request', (r) => { if (pick(r)) { sent.push(r); open.add(r); } });
  for (const done of ['requestfinished', 'requestfailed']) page.on(done, (r) => { open.delete(r); });
  const quiet = async (ms) => {
    await page.clock.runFor(ms);
    await until(() => open.size === 0, 'every ask is answered');
  };
  return { sent, quiet };
}

export async function lowContrast(page, selectors = ['[data-use-case-pane]', '[data-mvp-panel]', '[role="dialog"]']) {
  return page.evaluate((rootSelectors) => {
    document.getAnimations().filter((a) => a instanceof CSSTransition).forEach((a) => a.finish());
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const parse = (c) => {
      const m = String(c).match(/^rgba?\(([^)]+)\)$/);
      if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      ctx.fillStyle = '#010203';
      ctx.fillStyle = String(c);
      if (ctx.fillStyle === '#010203') return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const STOP = /(rgba?|hsla?|color|oklab|oklch|lab|lch)\([^)]*\)/g;
    const behind = (el) => {
      const layers = [];
      let opaque = false;
      for (let e = el; e && !opaque; e = e.parentElement) {
        const s = getComputedStyle(e);
        const clipText = s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text';
        if (!clipText && s.backgroundImage.includes('gradient')) {
          const stops = (s.backgroundImage.match(STOP) || []).map(parse).filter(Boolean);
          if (stops.length) {
            layers.push(stops);
            if (stops.every((c) => c.a >= 1)) { opaque = true; break; }
          }
        }
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) { layers.push([c]); if (c.a >= 1) opaque = true; }
      }
      let bases = [opaque ? { r: 0, g: 0, b: 0 } : parse(getComputedStyle(document.body).backgroundColor)];
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        bases = bases.flatMap((b) => layers[i].map((c) => ({ r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a) })));
      }
      return bases;
    };
    const found = rootSelectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
    const roots = found.filter((el, i) => found.indexOf(el) === i && !found.some((other) => other !== el && other.contains(el)));
    const low = [];
    let checked = 0;
    const opacityOf = (el) => {
      let op = 1;
      for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      return op;
    };
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
        if ((!own && el.tagName !== 'INPUT') || el.closest('button:disabled, input:disabled, [aria-disabled="true"], [aria-hidden="true"]')) continue;
        const style = getComputedStyle(el);
        const op = opacityOf(el);
        if (op === 0 || style.visibility === 'hidden' || style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text') continue;
        const fg = parse(style.color);
        fg.a *= op;
        const ratio = Math.min(...behind(el).map((bg) => {
          const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
          const [x, y] = [lum(mixed), lum(bg)].sort((m, n) => n - m);
          return (x + 0.05) / (y + 0.05);
        }));
        checked += 1;
        if (ratio < 4.5) low.push(`${(own || el.value || el.getAttribute('aria-label')).slice(0, 40)}: ${ratio.toFixed(2)}`);
      }
    }
    return { checked, low };
  }, selectors);
}

export async function lowContrastThroughAnimations(page, selectors, fractions = [0, 0.25, 0.5, 0.75]) {
  const low = new Set();
  let checked = 0;
  let animations = 0;
  for (const fraction of fractions) {
    animations = await page.evaluate((f) => {
      const running = document.getAnimations().filter((a) => a instanceof CSSAnimation);
      for (const a of running) {
        const timing = a.effect.getComputedTiming();
        a.pause();
        a.currentTime = (Number(timing.delay) || 0) + (Number(timing.duration) || 0) * f;
      }
      return running.length;
    }, fraction);
    const result = await lowContrast(page, selectors);
    checked = Math.max(checked, result.checked);
    for (const line of result.low) low.add(line.replace(/: [\d.]+$/, ''));
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  return { checked, animations, low: [...low] };
}

export function choicesShown(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-choice]')].filter((g) => g.getClientRects().length).map((g) => {
    const own = (el) => el.closest('[data-choice]') === g;
    const inside = (sel) => [...g.querySelectorAll(sel)].filter(own);
    const selected = [
      ...inside('input[type="radio"][value]:checked, input[type="checkbox"][value]:checked').map((i) => i.value),
      ...inside('[data-option][aria-pressed="true"]').map((b) => b.dataset.option),
      ...inside('select').map((s) => s.value),
      ...(g.hasAttribute('data-choice-value') ? [g.dataset.choiceValue] : []),
    ];
    return { choice: g.dataset.choice, multi: g.hasAttribute('data-choice-multi'), selected, badges: inside('[data-recommended]').map((b) => b.dataset.recommended) };
  }));
}

export async function settleChoices(page) {
  await page.waitForFunction(() => !document.querySelector('[data-wizard-body] .animate-spin, [role="dialog"] .animate-spin, [role="status"].animate-pulse'), null, { timeout: 15000 });
}

export function assertOneBadgeOnDefault(shown, where, { perChoice = false } = {}) {
  const sets = perChoice ? shown.map((c) => c.badges) : [shown.flatMap((c) => c.badges)];
  for (const all of sets) assert.ok(all.length <= 1, `${where}: at most one Recommended badge ${perChoice ? 'on each question' : 'on the step'}, has ${JSON.stringify(all)}`);
  for (const { choice, multi, selected, badges } of shown) {
    if (!badges.length) continue;
    if (multi) assert.ok(selected.includes(badges[0]), `${where}: ${choice} starts with its badged option ${badges[0]} ticked, ticked ${JSON.stringify(selected)}`);
    else assert.deepEqual(selected, [badges[0]], `${where}: ${choice} starts on its badged option`);
  }
}

export const profileAt = (calls, answer, { status = 200, after = 0 } = {}) => async (page) => {
  await page.route('**/api/grouping/profile', async (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'));
    if (after) await new Promise((done) => setTimeout(done, after));
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(answer) });
  });
};

export async function openDetails(page) {
  await page.locator('[data-use-case-details-open]').click();
  return page.getByRole('dialog', { name: /^Use case details: / });
}

export function stubMoney(path, answerOf, calls) {
  return async (page) => {
    await page.route(`**/api/money/${path}`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answerOf(body)) });
    });
  };
}

export async function goToStorage(page) {
  await goToStep(page, 'Page storage');
  return page.getByRole('group', { name: 'How fast do the App\'s pages open?' });
}

export async function onMoneyPart(page, part) {
  const current = `li[data-money-current] [data-money-part="${part}"]`;
  for (let i = 0; i < 5 && !(await page.locator(current).count()); i += 1) await page.locator('[data-money-next]').click();
  await page.locator(current).waitFor({ timeout: 15000 });
}

export async function goToMeasureImpact(page) {
  await goToStep(page, 'Measure');
  const onImpact = () => page.locator('[data-money-part="impact"]').evaluate((el) => el.closest('li').hasAttribute('data-money-current'));
  for (let i = 0; i < 6 && !(await onImpact()); i += 1) await page.locator('[data-money-next]').click();
  await page.getByRole('group', { name: 'Measure impact' }).waitFor();
}
