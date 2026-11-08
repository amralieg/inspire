import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, tracked } from './harness.mjs';
import { dropCopies, fillWithCopies, wheelScrolls } from '../../../../../frontend/test/ui/wheelScroll.mjs';

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

const copies = (region, item, n) => ({ fill: () => fillWithCopies(region, item, n), unfill: () => dropCopies(region) });
const real = (errors) => errors.filter((e) => !/Failed to load resource/.test(e));

test('the mouse wheel scrolls the Ask Genie conversation to its last message at 1280x800 and 1024x700', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { width: 1280, height: 800, routes: tracked().routes });
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const box = page.locator('aside.genie').getByRole('textbox', { name: 'Your question' });
  await box.fill('Which category lost the most?');
  await box.press('Enter');
  const log = page.getByRole('log', { name: 'Genie conversation' });
  await log.locator('.msg--genie .msg-b').first().waitFor({ timeout: 15000 });
  await wheelScrolls(page, log, () => log.locator('[data-wheel-copy]').last(), { name: 'Ask Genie conversation', ...copies(log, ':scope > *', 12) });
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});

