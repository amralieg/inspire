import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, goRail, openApp, serveDist } from './harness.mjs';
import { EXAMPLES } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const genieOpen = (page) => page.evaluate(() => !!document.querySelector('aside.genie.is-open'));

test('Ask Genie opened on the Dashboard stays open across Work and Runs', async () => {
  const example = EXAMPLES['monitor_triage.json'];
  const { page, context } = await openApp(browser, served.base, appInfo(example.settings, 1, {}, 'examples/monitor_triage.json'), { width: 1280, height: 800, routes: example.routes() });
  await example.ready(page);
  await page.locator('button.genie-btn').click();
  await page.waitForFunction(() => !!document.querySelector('aside.genie.is-open'));
  await goRail(page, 'work');
  await page.waitForTimeout(800);
  assert.equal(await genieOpen(page), true, 'Work keeps the Genie panel open');
  await goRail(page, 'runs');
  await page.waitForTimeout(800);
  assert.equal(await genieOpen(page), true, 'Runs keeps the Genie panel open');
  await context.close();
});
