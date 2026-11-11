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
