import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { NO_JOB, appInfo, openApp, serveDist } from './harness.mjs';

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

const genieOpen = (page) => page.locator('[data-genie-full]').count();
const openGenieMode = async (page) => {
  await page.locator('[data-mode-switch] [data-mode="genie"]').click();
  await page.locator('[data-genie-full]').waitFor({ state: 'visible' });
};

// REQ-506: Genie no longer opens as a panel on first load. A browser session lands on Work, Genie is the other side of the Screen | Genie switch, and a switch back to Screen holds across a reload.
test('a browser session lands on Work with Genie closed, and Screen chosen after Genie holds across a reload', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { genie: 'open' });
  try {
    await page.locator('[data-mode-switch]').waitFor({ timeout: 20000 });
    assert.equal(await genieOpen(page), 0, 'Genie is not open on the first load');
    await openGenieMode(page);
    assert.equal(await genieOpen(page), 1, 'Genie opens from the switch');
    await page.locator('[data-mode-switch] [data-mode="screen"]').click();
    await page.locator('[data-genie-full]').waitFor({ state: 'detached', timeout: 10000 });
    await page.reload();
    await page.locator('[data-ready], .fatal').first().waitFor({ state: 'attached', timeout: 60000 });
    await page.waitForTimeout(1500);
    assert.equal(await genieOpen(page), 0, 'a switch back to Screen holds after a reload');
  } finally {
    await context.close();
  }
});

const ACTIVE = { run_id: '9', result: 'running', state: 'running', started: new Date(Date.now() - 60000).toISOString(), stage: 'Running the use case', stage_index: 2, stage_total: 5, rows_done: null, rows_total: null, percent: null, eta_s: null, silent_since: null, source: 'marker' };
const LAST = { run_id: '8', status: 'done', started: new Date(Date.now() - 3600000).toISOString(), ended: new Date(Date.now() - 3000000).toISOString(), trigger: 'refresh', by: '' };

test('REQ-092: the Genie panel shows the build step on top when opened while a build runs', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { genie: 'open', routes: { freshness: ({ json }) => json(200, { ...NO_JOB, has_job: true, active: ACTIVE }) } });
  try {
    await openGenieMode(page);
    const line = page.locator('[data-genie-full] [data-build-status]');
    await line.waitFor({ timeout: 20000 });
    assert.match(await line.innerText(), /Step 2 of 5: Running the use case/, 'the panel says which build step is running');
    assert.equal(await page.locator('[data-genie-full] .g-h + [data-build-status]').count(), 1, 'the line sits right under the panel header');
  } finally {
    await context.close();
  }
});

test('REQ-092: after a build finishes, the Genie panel says how the latest run ended when opened', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { genie: 'open', routes: { freshness: ({ json }) => json(200, { ...NO_JOB, has_job: true, last_run: LAST, last_success: LAST }) } });
  try {
    await openGenieMode(page);
    const line = page.locator('[data-genie-full] [data-build-status]');
    await line.waitFor({ timeout: 20000 });
    assert.match(await line.innerText(), /^Latest run/, 'the panel says how the latest run ended');
  } finally {
    await context.close();
  }
});
