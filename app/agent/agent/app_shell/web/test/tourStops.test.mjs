import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { NO_MONEY, appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });

const boxesWithoutStop = (page) => page.evaluate(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const boxes = [...document.querySelectorAll('main section.card, main [data-value-now], main [data-value-saved]')]
    .filter((el) => shown(el) && !el.closest('.tour'));
  return boxes.filter((el) => !el.closest('[data-tour]') && !el.querySelector('[data-tour]'))
    .map((el) => el.getAttribute('aria-label') || el.textContent.trim().slice(0, 60));
});

async function walkStops(page) {
  const stops = [];
  await page.locator('.tour-pop[data-side]').waitFor({ timeout: 45000 });
  for (let i = 0; i < 25; i += 1) {
    const tour = page.locator('.tour');
    if (!(await tour.count())) break;
    // A step whose anchor is not on the screen is skipped after a wait, and the last skipped step ends the tour.
    await page.waitForFunction(() => !document.querySelector('.tour') || document.querySelector('.tour-pop[data-side]'), null, { timeout: 45000 });
    if (!(await tour.count())) break;
    const anchor = await tour.getAttribute('data-tour-on');
    stops.push({
      anchor,
      found: await page.evaluate((a) => [...document.querySelectorAll(`[data-tour="${a}"]`)].some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }), anchor),
      title: ((await page.locator('.tour-pop h4').textContent()) || '').trim(),
      text: ((await page.locator('.tour-pop p').textContent()) || '').trim(),
    });
    // the pop re-anchors between steps, so Playwright never sees the button stable; the click event is sent to it directly
    await page.locator('[data-tour-next]').dispatchEvent('click', null, { timeout: 45000 });
  }
  return stops;
}

test('every box on the page has a tour stop, so the tour reaches all of them', async () => {
  const info = appInfo();
  info.pages[0].is_owner = true;
  const { page, context } = await openApp(browser, served.base, info, { hash: '#/n01_u05/dashboard' });
  try {
    assert.deepEqual(await boxesWithoutStop(page), [], 'boxes on the page with no tour stop');
  } finally {
    await context.close();
  }
});

async function walked() {
  const money = { routes: { money: ({ json }) => json(200, { ...NO_MONEY, saved: { since: '2026-11-01T00:00:00Z', lines: [], warning: '' } }) } };
  const info = appInfo();
  info.pages[0].is_owner = true;
  const { page, context } = await openApp(browser, served.base, info, { hash: '?tour=1', watch: STILL, ...money });
  try {
    return await walkStops(page);
  } finally {
    await context.close();
  }
}

test('the tour walks to the What to do now box, each stop with a title and a text', async () => {
  const stops = await walked();
  const anchors = stops.filter((s) => s.found).map((s) => s.anchor);
  assert.ok(anchors.includes('todo'), `the tour has no stop on todo; it walked ${anchors.join(', ')}`);
  for (const stop of stops) {
    assert.ok(stop.title, `stop ${stop.anchor} has a title`);
    assert.ok(stop.text, `stop ${stop.anchor} has a text`);
  }
});

// PRODUCT GAP (REQ-506): the template tour (kinds.json tour.layouts) still names value, saved and settings, but nothing in the new shell carries
// data-tour for them (ValueChip.jsx, AvatarMenu.jsx; only Dashboard, Kpis, FilterBar, Layouts and Records set it), so Tour.jsx skips each after 4 s.
test('the tour walks to the value line, the Saved line and Settings, which holds Feedback and Reported issues', async () => {
  const stops = await walked();
  const anchors = stops.filter((s) => s.found).map((s) => s.anchor);
  for (const anchor of ['value', 'saved', 'settings']) {
    assert.ok(anchors.includes(anchor), `the tour has no stop on ${anchor}; it walked ${anchors.join(', ')}`);
  }
});
