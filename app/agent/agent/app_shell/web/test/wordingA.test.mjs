import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { EXAMPLES, monitorRoutes } from './exampleRoutes.mjs';

let served;
let base;
let browser;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

test('a Genie answer that ran a query names its SQL disclosure in plain words, never SQL', async () => {
  const spec = EXAMPLES['monitor_triage.json'];
  const info = appInfo(spec.settings, 1, {}, 'examples/monitor_triage.json');
  const { page, context, seen } = await openApp(browser, base, info, { width: 1280, height: 800, routes: spec.routes(), ready: '[data-section]' });
  await spec.ready(page);
  await page.locator('[aria-label="Ask Genie"]').first().click();
  const input = page.locator('.genie input').first();
  await input.fill('Which items lost the most?');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.g-log')?.innerText.includes('The SQL Genie ran') || document.querySelector('.msg-sql > summary'), null, { timeout: 60000 });
  const summary = await page.locator('.msg-sql > summary').first().innerText();
  assert.doesNotMatch(summary, /\bSQL\b/, `summary says: ${summary}`);
  assert.equal(summary.trim(), 'How Genie got this');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Runs table draws no money card box on its Could save column', async () => {
  const spec = EXAMPLES['planner.json'];
  const info = appInfo(spec.settings, 1, {}, 'examples/planner.json');
  const { page, context, seen } = await openApp(browser, base, info, { width: 1280, height: 800, routes: spec.routes(), ready: '[data-section]' });
  await spec.ready(page);
  await page.locator('[data-rail="runs"]').click();
  await page.waitForFunction(() => document.querySelector('table th') !== null);
  assert.equal(await page.locator('table th.money, table td.money').count(), 0, 'a table cell carries the money card class');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
