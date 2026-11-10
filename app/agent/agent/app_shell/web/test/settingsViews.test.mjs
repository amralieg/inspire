import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, goRail, openApp, serveDist } from './harness.mjs';
import { EXAMPLES } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const viewsButtons = (page) => page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === 'Views').length);

test('Settings has one Views control, and the other pages keep theirs in the header', async () => {
  const example = EXAMPLES['agent_chat.json'];
  const { page, context } = await openApp(browser, served.base, appInfo(example.settings, 1, {}, 'examples/agent_chat.json'), { width: 1280, height: 800, routes: example.routes() });
  await example.ready(page);
  assert.equal(await viewsButtons(page), 1, 'the Ask page has its header Views control');
  await goRail(page, 'settings');
  await page.waitForFunction(() => document.querySelector('[data-section="settings"], #share') !== null || location.hash.endsWith('/settings'));
  await page.waitForTimeout(800);
  assert.equal(await viewsButtons(page), 1, 'Settings shows exactly one Views control, in Share and follow');
  await context.close();
});
