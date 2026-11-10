import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';
import { forecastRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const railOf = (page) => page.locator('[data-rail]').evaluateAll((items) => items.map((i) => [i.dataset.rail, i.textContent.trim()]));

test('a forecast App whose Accuracy screen is removed shows no Accuracy in its rail, and a link to it opens the Dashboard', async () => {
  const info = appInfo({ ...DECIDE, screens: { performance: false } }, 1, {}, 'examples/forecast_cockpit.json');
  const { page, seen, context } = await openApp(browser, served.base, info, { routes: forecastRoutes([]) });
  const id = info.pages[0].id;
  await page.locator('[data-rail]').first().waitFor();
  const rail = Object.fromEntries(await railOf(page));
  assert.equal(rail.work, 'Review');
  assert.equal(rail.performance, undefined, 'the Accuracy rail item is gone');
  await page.evaluate((p) => { window.location.hash = `#/${p}/performance`; }, id);
  await page.locator('[data-rail="dashboard"].is-on').waitFor();
  assert.equal(await page.locator('[data-accuracy]').count(), 0, 'a link to the removed screen never draws the Accuracy panel');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
