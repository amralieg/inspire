import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';
import { dashboardRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

test('the Explore table has a search box that narrows its rows, and clearing it brings every row back', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/dashboard.json');
  const asked = [];
  const { page, seen, context } = await openApp(browser, served.base, info, { routes: dashboardRoutes(asked) });
  const id = info.pages[0].id;
  await page.locator('[data-rail]').first().waitFor();
  await page.evaluate((p) => { window.location.hash = `#/${p}/work`; }, id);
  await page.locator('[data-mode-work="explore"] tbody tr').first().waitFor();
  const rows = page.locator('[data-mode-work="explore"] tbody tr');
  const all = await rows.count();
  assert.ok(all > 0, 'the table has rows to search');
  const box = page.locator('[data-table-search]').first();
  await box.fill('zz-no-such-value-zz');
  assert.equal(await rows.count(), 0);
  assert.match(await page.locator('[data-mode-work="explore"]').textContent(), /No row matches this search/);
  await box.fill('');
  assert.equal(await rows.count(), all);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a capped table sends its search to the server, and shows the rows the server returns for it', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/dashboard.json');
  const searched = [];
  const page = ({ route, json }) => {
    const body = route.request().postDataJSON();
    const text = Object.values(body.table_search || {})[0] || '';
    searched.push(text);
    const all = [{ entity_label: 'Oat bar', region: 'North', revenue: 900000, prior_value: 810000, change: 90000 },
      { entity_label: 'Tea tin', region: 'South', revenue: 300000, prior_value: 310000, change: -10000 }];
    const rows = all.filter((r) => !text || JSON.stringify(r).toLowerCase().includes(text.toLowerCase()));
    return json(200, { kpis: {}, charts: {}, tables: { rows: { columns: [], rows, truncated: true } }, errors: {} });
  };
  const { page: browserPage, seen, context } = await openApp(browser, served.base, info, { routes: { page } });
  const id = info.pages[0].id;
  await browserPage.locator('[data-rail]').first().waitFor();
  await browserPage.evaluate((p) => { window.location.hash = `#/${p}/work`; }, id);
  await browserPage.locator('[data-mode-work="explore"] tbody tr').first().waitFor();
  await browserPage.locator('[data-table-search]').first().fill('tea');
  await browserPage.waitForFunction(() => document.querySelectorAll('[data-mode-work="explore"] tbody tr').length === 1);
  await browserPage.waitForResponse((res) => res.url().includes('/page') && (res.request().postData() || '').includes('"tea"'));
  assert.ok(searched.includes('tea'), `the server was asked for the search, asked ${JSON.stringify(searched)}`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
