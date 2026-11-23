// REQ-508 L2 (Art Director pass, direction "A Calm Console", approved by Amr): the header steps say what the person can do next, and
// route changes use the motion tokens. Audit scratch/req508_art_director.md F8, F27, F28 and sections 2.3 and 3.2.
// Fail-pre (15eb146b9): Home is numbered 01, Launch and generate-data highlight no step, Review and Run are enabled with no run at all,
// the route enters over 350 ms and leaves over 200 ms (not 280 / 120), and the particle canvas runs behind every work page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const KNOWN = { ...REVIEW_STATE, knownRuns: ['42', '41', '50', '51', '60', '61'] };
const NO_RUNS = { sessions: [], results: null, history: [], knownRuns: [] };
const tabs = (page) => page.locator('header nav button');
const labels = async (page) => (await tabs(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const tab = (page, label) => tabs(page).filter({ hasText: new RegExp(`${label}$`) });
const current = async (page) => (await page.locator('header nav [aria-current="page"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const at = (page, want) => page.waitForFunction((h) => window.location.hash === h, want, { timeout: 20000 });

async function opened(state, hash) {
  const ui = await openUi('app', state, hash, { mount });
  await ui.page.locator('header nav button').first().waitFor({ timeout: 20000 });
  return ui;
}

test('F8: the header steps are 01 Start to 05 Run; Home is the logo link with no number', async () => {
  const ui = await opened(KNOWN, '#/start');
  const { page } = ui;
  try {
    assert.deepEqual(await labels(page), ['01 Start', '02 Monitor', '03 Review', '04 Build', '05 Run']);
    assert.deepEqual(await current(page), ['01 Start']);
    const brand = page.locator('header').getByRole('button', { name: /Inspire AI/ }).or(page.locator('header').getByRole('link', { name: /Inspire AI/ }));
    assert.equal(await brand.count(), 1, 'the logo is the one way home');
    assert.equal(await page.locator('header nav').getByText('Home', { exact: false }).count(), 0, 'Home is not a numbered step (must-exclude)');
    await brand.click();
    await at(page, '#/home');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

for (const hash of ['#/launch', '#/generate-data']) {
  test(`F8: on ${hash} the Start step is the current step`, async () => {
    const ui = await opened(KNOWN, hash);
    const { page } = ui;
    try {
      await at(page, hash);
      await page.waitForFunction(() => document.querySelectorAll('header nav [aria-current="page"]').length === 1, null, { timeout: 15000 });
      assert.deepEqual(await current(page), ['01 Start']);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('F8: with no run yet Monitor, Review, Build and Run are disabled and each says why; with a finished run Review and Run open (must-keep)', async () => {
  const empty = await opened(NO_RUNS, '#/start');
  try {
    for (const label of ['Monitor', 'Review', 'Build', 'Run']) {
      const button = tab(empty.page, label);
      assert.equal(await button.isDisabled(), true, `${label} is disabled with no run`);
      const why = String(await button.getAttribute('title') || '');
      assert.match(why, new RegExp(`^${label}: \\S.{10,}`), `${label} says why it is locked, got "${why}"`);
    }
    assert.equal(await tab(empty.page, 'Start').isDisabled(), false);
    assert.deepEqual(empty.pageErrors, []);
  } finally {
    await empty.close();
  }
  const known = await opened(KNOWN, '#/start');
  try {
    assert.equal(await tab(known.page, 'Review').isDisabled(), false, 'Review opens once a run has results');
    assert.equal(await tab(known.page, 'Run').isDisabled(), false, 'Run opens once an MVP notebook exists');
  } finally {
    await known.close();
  }
});

// Every animation the route container runs while the page changes, as [name, duration, easing].
async function routeAnimations(page, go) {
  await page.evaluate(() => {
    window.__routeAnimations = [];
    const seen = new Set();
    const note = () => {
      const main = document.querySelector('main');
      if (!main) return;
      const s = getComputedStyle(main);
      const key = `${s.animationName}|${s.animationDuration}|${s.animationTimingFunction}`;
      if (!seen.has(key)) { seen.add(key); window.__routeAnimations.push([s.animationName, s.animationDuration, s.animationTimingFunction]); }
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const tick = () => { note(); if (window.__routeAnimations.length < 50) requestAnimationFrame(tick); };
    tick();
  });
  await go();
  await page.waitForTimeout(900);
  return page.evaluate(() => window.__routeAnimations.filter(([name]) => name && name !== 'none'));
}

test('F27: a route change leaves over 120 ms (--dur-fast) and enters over 280 ms (--dur-slow) with the ease-out curve', async () => {
  const ui = await opened(KNOWN, '#/start');
  const { page } = ui;
  try {
    const seen = await routeAnimations(page, () => tab(page, 'Review').click());
    await at(page, '#/review/42');
    const durations = [...new Set(seen.map(([, d]) => d))].sort();
    assert.deepEqual(durations, ['0.12s', '0.28s'], `route animations seen: ${JSON.stringify(seen)}`);
    const enter = seen.find(([, d]) => d === '0.28s');
    assert.equal(enter[2].replace(/\s+/g, ''), 'cubic-bezier(0.16,1,0.3,1)', 'the incoming page uses --ease-out');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('transition rule 6: with prefers-reduced-motion the route change runs no animation longer than an 80 ms fade (must-keep)', async () => {
  const ui = await openUi('app', KNOWN, '#/start', { mount, init: (page) => page.emulateMedia({ reducedMotion: 'reduce' }) });
  const { page } = ui;
  try {
    await page.locator('header nav button').first().waitFor({ timeout: 20000 });
    const seen = await routeAnimations(page, () => tab(page, 'Review').click());
    await at(page, '#/review/42');
    const long = seen.filter(([, d]) => d.split(',').some((x) => parseFloat(x) > 0.08));
    assert.deepEqual(long, [], 'no route animation longer than 80 ms under reduced motion');
  } finally {
    await ui.close();
  }
});

test('F28 (Amr: decorative effects on Landing only): the particle canvas runs on Home and on no work page', async () => {
  const ui = await opened(KNOWN, '#/start');
  const { page } = ui;
  try {
    assert.equal(await page.locator('canvas.particle-canvas').count(), 0, 'no particles behind Start');
    await tab(page, 'Review').click();
    await at(page, '#/review/42');
    await page.getByRole('heading', { level: 1, name: 'Review' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('canvas.particle-canvas').count(), 0, 'no particles behind Review');
    await page.locator('header').getByRole('button', { name: /Inspire AI/ }).click();
    await at(page, '#/home');
    await page.getByText('Scroll to explore').waitFor({ timeout: 20000 });
    assert.ok(await page.locator('canvas.particle-canvas').count() >= 1, 'Home keeps its particles (must-keep)');
  } finally {
    await ui.close();
  }
});
