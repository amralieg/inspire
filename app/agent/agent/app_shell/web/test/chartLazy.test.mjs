import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { appInfo, openApp, serveDist, until } from './harness.mjs';

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

test('a chart with a click filter sends its pick to the server after the lazy init', async () => {
  const example = JSON.parse(readFileSync(new URL('../../example_page.json', import.meta.url), 'utf8'));
  const charts = example.charts.map((c) => (c.id === 'by_category' ? { ...c, click_filter: 'category' } : c));
  const urls = [];
  const watch = (page) => page.on('request', (r) => { if (r.url().includes('/api/')) urls.push(`${r.url()} ${r.postData() || ''}`); });
  const { page, context, seen } = await openApp(browser, served.base, appInfo({ auth: 'sp' }, 1, { charts }), {
    ready: '[data-card] canvas', watch,
  });
  try {
    const card = (title) => page.locator('[data-card]').filter({ hasText: title }).locator('canvas').first();
    const picked = card('Where the loss sits');
    await picked.waitFor();
    const drawn = await picked.evaluate((el) => el.width > 0 && el.height > 0);
    assert.ok(drawn, 'the click-filter chart is drawn');
    const box = await picked.boundingBox();
    const before = urls.length;
    for (const fx of [0.15, 0.3, 0.5, 0.7]) {
      for (const fy of [0.3, 0.5, 0.7]) {
        await picked.click({ position: { x: box.width * fx, y: box.height * fy } });
      }
    }
    await until(() => urls.length > before, 5000);
    assert.ok(urls.slice(before).some((u) => /"category"|category/.test(u)), `the pick names its filter: ${urls.slice(before).join(' | ')}`);
    assert.deepEqual(seen.errors, [], 'no page error on click');
  } finally {
    await context.close();
  }
});
