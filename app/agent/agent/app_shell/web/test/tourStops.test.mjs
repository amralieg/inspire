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

const boxesWithoutStop = (page) => page.evaluate(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const boxes = [...document.querySelectorAll('main section.card, main [data-value-now], main [data-value-saved], main [data-rail]')]
    .filter((el) => shown(el) && !el.closest('.tour') && !['dashboard', 'work'].includes(el.dataset.rail));
  return boxes.filter((el) => !el.closest('[data-tour]') && !el.querySelector('[data-tour]'))
    .map((el) => el.getAttribute('aria-label') || el.dataset.rail || el.textContent.trim().slice(0, 60));
});

async function walkStops(page) {
  const stops = [];
  for (let i = 0; i < 25; i += 1) {
    const tour = page.locator('.tour');
    if (!(await tour.count())) break;
    await page.locator('.tour-pop[data-side]').waitFor({ timeout: 20000 });
    stops.push({
      anchor: await tour.getAttribute('data-tour-on'),
      title: ((await page.locator('.tour-pop h4').textContent()) || '').trim(),
      text: ((await page.locator('.tour-pop p').textContent()) || '').trim(),
    });
    await page.locator('[data-tour-next]').click({ timeout: 20000 });
  }
  return stops;
}

test('every box on the page has a tour stop, so the tour reaches all of them', async () => {
  const info = appInfo();
  info.pages[0].is_owner = true;
  const { page, context } = await openApp(browser, served.base, info, {});
  try {
    assert.deepEqual(await boxesWithoutStop(page), [], 'boxes on the page with no tour stop');
  } finally {
    await context.close();
  }
});

test('the tour walks to the What to do now box, the value line, the Saved line and Settings, which holds Feedback and Reported issues, each with a title and a text', async () => {
  const money = { routes: { money: ({ json }) => json(200, { ...NO_MONEY, saved: { since: '2026-11-01T00:00:00Z', lines: [], warning: '' } }) } };
  const info = appInfo();
  info.pages[0].is_owner = true;
  const { page, context } = await openApp(browser, served.base, info, { hash: '?tour=1', ...money });
  try {
    const stops = await walkStops(page);
    const anchors = stops.map((s) => s.anchor);
    for (const anchor of ['todo', 'value', 'saved', 'settings']) {
      assert.ok(anchors.includes(anchor), `the tour has no stop on ${anchor}; it walked ${anchors.join(', ')}`);
    }
    for (const stop of stops) {
      assert.ok(stop.title, `stop ${stop.anchor} has a title`);
      assert.ok(stop.text, `stop ${stop.anchor} has a text`);
    }
  } finally {
    await context.close();
  }
});
