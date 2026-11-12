import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, resizeTo, serveDist } from './harness.mjs';

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

const TITLE = 'Passenger profiles that may belong to the same person';

for (const width of [1280, 1440]) {
  test(`at ${width}px with Ask Genie open, the page title keeps a readable width and wraps by words, not letters`, async () => {
    const { page, context } = await openApp(browser, served.base, appInfo({}, 1, { title: TITLE }), { width, height: 800 });
    try {
      await page.locator('aside.genie.is-open').waitFor({ timeout: 20000 });
      await resizeTo(page, width, 800);
      const box = await page.locator('.pg-h > h1').boundingBox();
      const lineHeight = await page.locator('.pg-h > h1').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      assert.ok(box.width >= 240, `title is ${Math.round(box.width)}px wide at ${width}px, needs 240px`);
      assert.ok(box.height <= lineHeight * 4.5, `title is ${Math.round(box.height / lineHeight)} lines tall at ${width}px, needs at most 4`);
    } finally {
      await context.close();
    }
  });
}
