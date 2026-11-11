import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

test('charts draw after ECharts loads on first use, and a chart still exports after the lazy init', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ auth: 'sp' }, 1), { ready: '[data-card] canvas' });
  try {
    const canvas = page.locator('[data-card] canvas').first();
    await canvas.waitFor();
    assert.ok(await canvas.evaluate((el) => el.width > 0 && el.height > 0), 'the chart is drawn on its canvas');
    await canvas.click({ position: { x: 10, y: 10 } });
    const menu = page.getByRole('button', { name: /^Export / }).first();
    await menu.click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download SVG' }).click()]);
    assert.match(download.suggestedFilename(), /\.svg$/, 'the SVG export downloads after the lazy init');
    assert.deepEqual(seen.errors, [], 'no page error from the lazy chart code');
  } finally {
    await context.close();
  }
});
