import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { EXAMPLES } from './exampleRoutes.mjs';

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

test('a planner page gives each KPI strip its own heading, so the objective KPI never repeats Key numbers', async () => {
  const spec = EXAMPLES['planner.json'];
  const info = appInfo(spec.settings, 1, {}, 'examples/planner.json');
  const { page, context, seen } = await openApp(browser, base, info, { width: 1280, height: 800, routes: spec.routes(), ready: '[data-section]' });
  await spec.ready(page);
  const headings = await page.locator('.fold-t').allTextContents();
  assert.equal(new Set(headings).size, headings.length, `headings repeat: ${JSON.stringify(headings)}`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
