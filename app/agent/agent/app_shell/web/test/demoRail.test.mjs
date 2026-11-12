import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

const NOW = Date.parse('2026-10-27T09:30:00Z');
let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await served?.close?.();
});

test('the Feedback group sits in Settings only when the demo recorded its route, and never on the nav', async () => {
  const kept = appInfo();
  const shown = await openApp(browser, served.base, kept, { clock: NOW });
  await shown.page.locator('[data-rail="settings"]').click();
  await shown.page.locator('[data-group="feedback"]').waitFor({ timeout: 15000 });
  assert.equal(await shown.page.locator('[data-rail="feedback"]').count(), 0, 'Feedback is not a nav entry');
  await shown.context.close();

  const gone = appInfo();
  gone.screens = { ...gone.screens, feedback: false };
  const hidden = await openApp(browser, served.base, gone, { clock: NOW });
  await hidden.page.locator('[data-rail="settings"]').click();
  await hidden.page.locator('[data-group="look"]').waitFor({ timeout: 15000 });
  assert.equal(await hidden.page.locator('[data-group="feedback"]').count(), 0, 'no Feedback group when the App turns it off');
  await hidden.context.close();
});
