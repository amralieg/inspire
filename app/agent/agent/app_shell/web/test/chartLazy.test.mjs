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
    await picked.scrollIntoViewIfNeeded();
    const pick = await picked.evaluate(async (canvas) => {
      const chart = await import('/assets/echarts.js');
      const echarts = Object.values(chart).find((v) => v && typeof v.getInstanceByDom === 'function');
      let container = canvas;
      let inst = echarts.getInstanceByDom(container);
      while (!inst && container.parentElement) { container = container.parentElement; inst = echarts.getInstanceByDom(container); }
      if (!inst) throw new Error('no ECharts instance on the chart');
      const option = inst.getOption();
      const raw = option.series[0].data[0];
      const value = typeof raw === 'object' && raw !== null ? raw.value : raw;
      const axis = [].concat(option.xAxis, option.yAxis).find((a) => a && a.type === 'category');
      const first = axis.data[0];
      const label = String(typeof first === 'object' && first !== null ? first.value : first);
      const [px, py] = inst.convertToPixel({ seriesIndex: 0 }, [value / 2, 0]);
      const rect = container.getBoundingClientRect();
      return { label, x: rect.left + px, y: rect.top + py };
    });
    assert.ok(pick.label.length > 0, 'the first bar has a category to pick');
    const before = urls.length;
    await page.mouse.click(pick.x, pick.y);
    await until(() => urls.length > before, 5000);
    const sent = urls.slice(before).join(' | ');
    assert.ok(sent.includes(pick.label), `the pick sends the first bar's category "${pick.label}": ${sent}`);
    assert.deepEqual(seen.errors, [], 'no page error on click');
  } finally {
    await context.close();
  }
});
