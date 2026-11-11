import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';
import { dashboardRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

test('the Use cases menu lists the Apps a sibling build added after this page loaded, without a reload', async () => {
  const info = appInfo(DECIDE, 2, {}, 'examples/dashboard.json');
  const sibling = { use_case_id: 'N09-U01', name: 'Sibling desk', url: 'https://sibling.example.com/app' };
  let reads = 0;
  const asked = [];
  const routes = { ...dashboardRoutes(asked), app: ({ json }) => json(200, { ...info, siblings: reads++ === 0 ? [] : [sibling] }) };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes });
  await page.locator('[data-use-cases]').waitFor();
  await page.locator('[data-use-cases]').click();
  await page.locator('[data-sibling="N09-U01"]').waitFor();
  assert.equal(await page.locator('[data-sibling="N09-U01"] b').textContent(), 'Sibling desk');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
