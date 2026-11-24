import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { EXAMPLES } from './exampleRoutes.mjs';

// REQ-506: no side rail; Settings is an item of the avatar menu.
const goSettings = async (page) => {
  await page.locator('[data-avatar-menu] button').first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
};

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const viewsButtons = (page) => page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === 'Views').length);

async function openChat() {
  const example = EXAMPLES['agent_chat.json'];
  const opened = await openApp(browser, served.base, appInfo(example.settings, 1, {}, 'examples/agent_chat.json'), { width: 1280, height: 800, routes: example.routes() });
  await example.ready(opened.page);
  return opened;
}

// PRODUCT GAP (REQ-506): AskMode.jsx Work (line 16) takes no `views`, so the Ask page lost its Views control (Page.jsx:297 passes it, AskMode ignores it).
test('the Ask page keeps its Views control', async () => {
  const { page, context } = await openChat();
  assert.equal(await viewsButtons(page), 1, 'the Ask page has its Views control');
  await context.close();
});

test('Settings has exactly one Views control, in Share and follow', async () => {
  const { page, context } = await openChat();
  await goSettings(page);
  await page.waitForFunction(() => document.querySelector('[data-section="settings"], #share') !== null || location.hash.endsWith('/settings'));
  await page.waitForTimeout(800);
  assert.equal(await viewsButtons(page), 1, 'Settings shows exactly one Views control, in Share and follow');
  await context.close();
});
