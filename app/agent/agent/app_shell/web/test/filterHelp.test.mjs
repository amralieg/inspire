import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

test('the filter bar has its own ? that opens a one-step tour of the filters', async () => {
  const { page, context, seen } = await openApp(browser, served.base, appInfo({}, 1, {}), { watch: (p) => p.emulateMedia({ reducedMotion: 'reduce' }) });
  const help = page.locator('section.fbar [data-section-help]');
  await help.waitFor();
  await help.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tour-pop');
  assert.equal(await page.locator('#tour-t').textContent(), 'Filters');
  assert.equal(await page.locator('.tour-step').textContent(), '1 / 1');
  assert.match(await page.locator('.tour-pop').textContent(), /narrow every chart, table and list/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});
