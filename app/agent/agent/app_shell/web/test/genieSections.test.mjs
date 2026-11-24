import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
// REQ-506: no side rail; a section opens by its hash.
const goRail = (page, id) => page.evaluate((s) => { location.hash = `#/${location.hash.split('/')[1]}/${s}`; }, id);
import { EXAMPLES } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

// REQ-506: Genie is a full-height mode of its own (Screen | Genie), no longer a panel that stays beside Work and Runs. The old
// "stays open across Work and Runs" becomes: Work and Runs show the screen, and the Genie button brings the same panel back.
const genieOpen = (page) => page.evaluate(() => !!document.querySelector('[data-genie-full]'));

test('Genie opened from the Dashboard gives way to Work and Runs and comes back with the Genie button', async () => {
  const example = EXAMPLES['monitor_triage.json'];
  const info = appInfo(example.settings, 1, {}, 'examples/monitor_triage.json');
  const { page, context } = await openApp(browser, served.base, info, { width: 1280, height: 800, routes: example.routes(), hash: `#/${info.pages[0].id}/dashboard` });
  await example.ready(page);
  await page.locator('[data-mode="genie"]').click();
  await page.waitForFunction(() => !!document.querySelector('[data-genie-full]'));
  await goRail(page, 'work');
  await page.waitForFunction(() => !document.querySelector('[data-genie-full]'));
  assert.equal(await page.locator('[data-mode="screen"]').getAttribute('aria-pressed'), 'true', 'Work is the screen');
  await goRail(page, 'runs');
  await page.waitForTimeout(500);
  assert.equal(await genieOpen(page), false, 'Runs is the screen');
  await page.locator('[data-mode="genie"]').click();
  await page.waitForFunction(() => !!document.querySelector('[data-genie-full]'));
  assert.equal(await genieOpen(page), true, 'the Genie button brings Genie back');
  await context.close();
});
