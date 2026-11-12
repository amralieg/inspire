import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, TABLE, appInfo, openApp, serveDist } from './harness.mjs';

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

const genieOpen = (page) => page.locator('aside.genie.is-open').count();

test('the Ask Genie panel opens on the first load of a browser session, and a close holds across a reload', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { genie: 'open' });
  try {
    await page.locator('aside.genie.is-open').waitFor({ timeout: 20000 });
    assert.equal(await genieOpen(page), 1, 'the panel is open on the first load');
    await page.locator('aside.genie button[aria-label="Close Ask Genie"]').click();
    await page.locator('aside.genie.is-open').waitFor({ state: 'detached', timeout: 10000 });
    await page.reload();
    await page.locator('[data-ready], .fatal').first().waitFor({ state: 'attached', timeout: 60000 });
    await page.waitForTimeout(1500);
    assert.equal(await genieOpen(page), 0, 'a close made in this session holds after a reload');
  } finally {
    await context.close();
  }
});

test('REQ-092: a Genie panel closed in this session stays closed after a docking cycle on the Work tab', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { genie: 'open', hash: '#/n01_u05/work' });
  try {
    await page.locator('.genie-btn').waitFor({ timeout: 20000 });
    await page.locator('.genie-btn').click();
    await page.locator('[data-rail="dashboard"]').click();
    await page.locator('aside.genie.is-open').waitFor({ timeout: 10000 });
    await page.locator('aside.genie button[aria-label="Close Ask Genie"]').click();
    await page.locator('aside.genie.is-open').waitFor({ state: 'detached', timeout: 10000 });
    await page.locator('[data-rail="work"]').click();
    await page.locator('[data-rail="dashboard"]').click();
    await page.waitForTimeout(1500);
    assert.equal(await genieOpen(page), 0, 'a close made in this session is not undone when the Work tab docks and undocks Genie');
  } finally {
    await context.close();
  }
});
