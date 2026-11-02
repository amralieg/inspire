import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, chartsDrawn, openApp, serveDist } from './harness.mjs';

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

const GUIDE = "What drives the result: Where the loss sits. Each tile reads the use case's results and answers to the filters above.";

test('the page shows the same Drivers heading and reading guide as the dashboard, over its Drivers charts only', async () => {
  const info = appInfo({}, 1, TABLE);
  assert.deepEqual(info.pages[0].drivers, { title: 'Drivers', charts: ['by_category'], guide: GUIDE }, 'the one page spec gives both');
  assert.deepEqual(info.pages[0].charts.map((c) => [c.id, c.driver]),
    [['loss_trend', false], ['by_category', true], ['channel_mix', false], ['pareto', false]]);
  const { page, seen, context } = await openApp(browser, served.base, info);
  try {
    await page.waitForFunction(chartsDrawn, 4);
    const drivers = page.getByRole('region', { name: 'Drivers' });
    assert.equal(await drivers.locator('.drivers-h h2').textContent(), 'Drivers');
    assert.equal(await drivers.locator('.drivers-h p').textContent(), GUIDE);
    assert.deepEqual(await drivers.locator('[data-card]').evaluateAll((cards) => cards.map((c) => c.dataset.card)), ['by_category']);
    const main = await page.locator('section.charts > [data-card]').evaluateAll((cards) => cards.map((c) => c.dataset.card));
    assert.deepEqual(main, ['loss_trend', 'channel_mix', 'pareto'], 'a Drivers chart is drawn once, in its section');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('a page with no Drivers chart shows no Drivers section', async () => {
  const plain = appInfo({}, 1, TABLE);
  const charts = plain.pages[0].charts.map((c) => ({ ...c, driver: false }));
  const info = { ...plain, pages: [{ ...plain.pages[0], charts, drivers: null }] };
  const { page, seen, context } = await openApp(browser, served.base, info);
  try {
    await page.waitForFunction(chartsDrawn, 4);
    assert.equal(await page.locator('[data-drivers]').count(), 0);
    assert.equal(await page.locator('section.charts > [data-card]').count(), 4);
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});
