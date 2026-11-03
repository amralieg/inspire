import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { HARNESS_USE_CASE } from './implementFixtures.js';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { makeApp, listen } = createRequire(import.meta.url)('../../../backend/test/support/implementApp.js');

export const VITE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-ui-vite-'));
process.once('exit', () => fs.rmSync(VITE_CACHE_DIR, { recursive: true, force: true }));

let browser;

export async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
}

export async function openUi(open, overrides = {}, query = '', { mount, init } = {}) {
  if (!browser) browser = await chromium.launch();
  const made = makeApp({ useCase: HARNESS_USE_CASE, ...overrides }, { mount });
  const backend = await listen(made.app);
  const vite = await createServer({
    root: frontend,
    configFile: path.join(frontend, 'vite.config.js'),
    cacheDir: VITE_CACHE_DIR,
    logLevel: 'error',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': backend.url, '/showcase': backend.url, '/run': backend.url }, hmr: false },
  });
  await vite.listen();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  if (init) await init(page, origin);
  await page.goto(`${origin}/test/ui/implement.html?open=${open}${query}`);
  return {
    made, page, pageErrors, origin,
    close: async () => { await page.close(); await vite.close(); await backend.close(); },
  };
}

export async function openBuild(state, { init } = {}) {
  const ui = await openUi('implement', state, '', { init });
  try {
    await ui.page.locator('[data-mvp-progress]').waitFor({ timeout: 15000 });
    return ui;
  } catch (e) {
    await ui.close();
    throw e;
  }
}

export async function openAsset(page, id) {
  const drawer = page.locator(`[data-mvp-panel="${id}"]`);
  if (await drawer.count()) return drawer;
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

export async function pollNow(page, route = '/api/inspire/implement/status', every = 10000) {
  const asked = page.waitForRequest((r) => r.url().includes(route), { timeout: 15000 });
  await page.clock.fastForward(every);
  const request = await asked;
  await request.response();
}

export async function onStep(page, label) {
  try {
    await page.locator('[aria-current="step"]', { hasText: label }).waitFor({ timeout: 15000 });
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

export async function dataToResults(page, { grouping = false } = {}) {
  for (const label of [...(grouping ? ['Grouping'] : []), 'First run', 'Results']) {
    await page.getByRole('button', { name: 'Next' }).click();
    await onStep(page, label);
  }
}

export async function toAppAccess(page) {
  await page.getByRole('button', { name: 'Next' }).click();
  await onStep(page, 'App placement');
  await page.getByText('Finding the Apps Inspire built').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Next' }).click();
  await onStep(page, 'App access');
}

export async function toVibes(page) {
  const current = page.locator('[aria-current="step"]');
  await current.waitFor({ timeout: 15000 });
  const steps = await page.locator('[data-wizard-header] ol li').count();
  for (let i = 0; i < steps && !(await current.innerText()).includes('Vibes'); i += 1) {
    const from = await current.innerText();
    await page.getByRole('button', { name: 'Next' }).click({ timeout: 15000 });
    try {
      await page.waitForFunction((was) => document.querySelector('[aria-current="step"]')?.innerText !== was, from, { timeout: 15000 });
    } catch (e) {
      const shown = await page.locator('[role="alert"] p').allTextContents();
      throw new Error(`Next did not leave "${from}": ${shown.join(' | ') || e.message}`);
    }
  }
  await onStep(page, 'Vibes');
}

export async function startMvp(page) {
  await toVibes(page);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start MVP' && !b.disabled),
    null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
}

export async function settled(page, selector, { loaded = false, timeout = 15000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const steady = await page.evaluate(({ sel, skeletons }) => new Promise((done) => {
      const el = document.querySelector(sel);
      if (!el || (skeletons && el.querySelector('.animate-pulse'))) {
        done(false);
        return;
      }
      const box = () => {
        const r = el.getBoundingClientRect();
        return [r.top, r.left, r.width, r.height, el.scrollHeight, el.scrollWidth, el.scrollTop, el.scrollLeft].join();
      };
      const first = box();
      requestAnimationFrame(() => requestAnimationFrame(() => done(box() === first)));
    }), { sel: selector, skeletons: loaded });
    if (steady) return;
  }
  throw new Error(`the layout of ${selector} did not settle in ${timeout} ms`);
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
