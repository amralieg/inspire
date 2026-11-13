import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, pageData, serveDist } from './harness.mjs';
import { ZERO_TITLE } from '../src/zeroState.js';

let served;
let browser;
let base;
before(async () => { served = await serveDist(); base = served.base; browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const FLAT = () => {
  const data = pageData({});
  const charts = Object.fromEntries(Object.entries(data.charts).map(([id, c]) => [id, { ...c, rows: c.rows.map((r) => ({ ...r, y0: 0 })) }]));
  return { ...data, charts, zero_state: { charts: Object.keys(charts).sort() } };
};

test('a page whose rule finds nothing shows one plain panel in place of the flat charts,', async () => {
  const { page, seen, context } = await openApp(browser, base, appInfo({ layout: 'sidebar' }, 1), {
    routes: { page: ({ json }) => json(200, FLAT()) }, hash: '#/n01_u05',
  });
  await page.waitForSelector('[data-zero-state]', { timeout: 15000 });
  assert.equal(await page.locator('[data-zero-state] h2').innerText(), ZERO_TITLE);
  assert.equal(await page.locator('[data-zero-state] canvas').count(), 0, 'no flat chart is drawn under the panel');
  assert.ok(await page.locator('[data-zero-refresh]').count() === 1);
  await page.screenshot({ path: '/tmp/zero_panel.png', fullPage: false });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the zero panel reads the rows the run checked, and shows no count when the run wrote none', async () => {
  for (const [rows_checked, shown] of [[3333, '3,333 rows checked'], [null, '']]) {
    const data = FLAT();
    const { page, seen, context } = await openApp(browser, base, appInfo({ layout: 'sidebar' }, 1), {
      routes: { page: ({ json }) => json(200, { ...data, zero_state: { ...data.zero_state, rows_checked } }) }, hash: '#/n01_u05',
    });
    await page.waitForSelector('[data-zero-state]', { timeout: 15000 });
    assert.equal(await page.locator('[data-zero-state] h2').innerText(), ZERO_TITLE);
    if (shown) assert.equal(await page.locator('[data-zero-checked]').innerText(), shown);
    else assert.equal(await page.locator('[data-zero-checked]').count(), 0, 'a missing count shows no line');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a page whose rule still finds exceptions draws its charts and shows no panel', async () => {
  const { page, seen, context } = await openApp(browser, base, appInfo({ layout: 'sidebar' }, 1), { hash: '#/n01_u05' });
  await page.waitForSelector('[data-card] canvas', { timeout: 15000 });
  assert.equal(await page.locator('[data-zero-state]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
