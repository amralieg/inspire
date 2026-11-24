// D-NOAGENT (Amr 2026-11-16, reaffirmed REQ-392): the Agent page is fully off for every experience, controlled by AGENT_PAGE_SHOWN in
// src/App.jsx. No nav item, no landing, and a deep link to #/<page>/agent falls back to the dashboard.
// REQ-506: the side rail and the Agent page are gone for good; the same rules now read the top bar and the avatar menu, and the fallback is Work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

// The App experiences are agentic, both and ui (ui is the classic App with no agent; there is no 'classic' value).
const EXPERIENCES = ['agentic', 'both', 'ui'];
const options = (experience) => ({ options: { modify: false, replace_edits: false, decisions: true, alerts: false, experience } });
// The top bar's own controls (use case picker, Screen | Genie, value chip, avatar) plus every item of the avatar menu, as the words a person reads.
async function menuWords(page) {
  await page.locator('[data-avatar-menu] button').first().click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible' });
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  return [...(await page.locator('header.top [data-mode]').allInnerTexts()).map((t) => t.trim()), ...items];
}
const errorsOf = (seen) => seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e));

for (const experience of EXPERIENCES) {
  test(`the top bar and the avatar menu have no Agent entry for experience '${experience}'`, async () => {
    const info = appInfo(options(experience));
    const pageId = info.pages[0].id;
    const { page, seen, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}/work`, ready: '[data-mode-switch]' });
    try {
      assert.equal(await page.locator('[data-rail], nav.side, [data-agent-page]').count(), 0, 'no rail and no Agent page');
      const labels = await menuWords(page);
      assert.ok(labels.length > 0, 'the top bar and the avatar menu have their normal entries');
      assert.ok(!labels.some((l) => /agent/i.test(l)), `the top bar and the avatar menu list ${labels.join(', ')}, not Agent`);
      assert.deepEqual(errorsOf(seen), [], 'no page errors');
    } finally {
      await context.close();
    }
  });
}

test('an agentic App opens on its Work list, not on the Agent page (AGENT_PAGE_SHOWN is false)', async () => {
  const info = appInfo(options('agentic'));
  const pageId = info.pages[0].id;
  const { page, seen, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}` });
  try {
    await page.locator('[data-mode-switch] [data-mode="screen"][aria-pressed="true"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-agent-page]').count(), 0, 'the Agent page is not shown');
    assert.match(page.url(), new RegExp(`#/${pageId}/work$`), 'the address lands on the Work section');
    assert.deepEqual(errorsOf(seen), [], 'no page errors');
  } finally {
    await context.close();
  }
});

for (const experience of ['agentic', 'ui']) {
  test(`a deep link to the Agent section of a '${experience}' App falls back to Work, with the page showing and no blank screen`, async () => {
    const info = appInfo(options(experience));
    const pageId = info.pages[0].id;
    const { page, seen, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}/agent` });
    try {
      await page.locator('[data-mode-switch] [data-mode="screen"][aria-pressed="true"]').waitFor({ timeout: 20000 });
      assert.equal(await page.locator('[data-agent-page]').count(), 0, 'the Agent page is not shown');
      assert.match(page.url(), new RegExp(`#/${pageId}/work$`), 'the address falls back to Work');
      assert.ok(await page.locator('main.main [data-page-section], main.main .kpi-v, main.main .hcard').count() > 0, 'the main area has a page, not a blank screen');
      assert.deepEqual(errorsOf(seen), [], 'no page errors');
    } finally {
      await context.close();
    }
  });
}

// REQ-392 (REQ-506: the avatar menu replaces the side menu): the menu at the two desk sizes, saved for review.
const SHOTS = '/private/tmp/inspire_v15/shots/u11';
for (const experience of ['agentic', 'ui']) {
  test(`REQ-392: the avatar menu of a '${experience}' App has no Agent entry at 1440x900 and 1280x800, and the screenshots are saved`, async () => {
    const info = appInfo(options(experience));
    const pageId = info.pages[0].id;
    const { page, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}/work`, ready: '[data-mode-switch]' });
    try {
      for (const [width, height] of [[1440, 900], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        await page.locator('[data-avatar-menu] button').first().click();
        await page.getByRole('menu').waitFor({ state: 'visible' });
        const items = (await page.getByRole('menu').getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
        assert.ok(items.length > 0, `the menu lists its entries at ${width}x${height}`);
        assert.ok(!items.some((t) => /agent/i.test(t)), `no Agent entry at ${width}x${height}: ${items.join(', ')}`);
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/req392-avatar-menu-${experience}-${width}x${height}.png` });
        await page.keyboard.press('Escape');
      }
    } finally {
      await context.close();
    }
  });
}
