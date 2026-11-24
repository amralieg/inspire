import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';
import { forecastRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

// REQ-506: no side rail. The names of the screens an owner can reach are the items of the avatar menu.
const menuTitles = async (page) => {
  await page.locator('[data-avatar-menu] button').first().click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible' });
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  return items;
};

test('a forecast App whose Accuracy screen is removed shows no Accuracy in its menu, and a link to it opens the Dashboard', async () => {
  const info = appInfo({ ...DECIDE, screens: { performance: false } }, 1, {}, 'examples/forecast_cockpit.json');
  info.pages.forEach((p) => { p.is_owner = true; });
  const { page, seen, context } = await openApp(browser, served.base, info, { routes: forecastRoutes([]), ready: '[data-ready]' });
  const id = info.pages[0].id;
  await page.locator('[data-avatar-menu]').waitFor();
  const items = await menuTitles(page);
  assert.ok(items.length > 0, 'the owner menu lists something');
  assert.equal(items.includes('Accuracy'), false, `the Accuracy menu item is gone: ${JSON.stringify(items)}`);
  assert.equal(items.includes('Performance'), false, `no Performance item either: ${JSON.stringify(items)}`);
  await page.evaluate((p) => { window.location.hash = `#/${p}/performance`; }, id);
  await page.waitForFunction((p) => !location.hash.endsWith('/performance'), id);
  assert.equal(await page.locator('[data-accuracy]').count(), 0, 'a link to the removed screen never draws the Accuracy panel');
  assert.equal(await page.locator('[data-performance]').count(), 0, 'a link to the removed screen never draws the Performance screen');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
