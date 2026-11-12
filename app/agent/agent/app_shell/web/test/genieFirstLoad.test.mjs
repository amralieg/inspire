import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, NO_JOB, TABLE, appInfo, openApp, serveDist } from './harness.mjs';

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

const ACTIVE = { run_id: '9', result: 'running', state: 'running', started: new Date(Date.now() - 60000).toISOString(), stage: 'Running the use case', stage_index: 2, stage_total: 5, rows_done: null, rows_total: null, percent: null, eta_s: null, silent_since: null, source: 'marker' };
const LAST = { run_id: '8', status: 'done', started: new Date(Date.now() - 3600000).toISOString(), ended: new Date(Date.now() - 3000000).toISOString(), trigger: 'refresh', by: '' };

test('REQ-092: the Genie panel opens on first load with the build step on top while a build runs', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { genie: 'open', routes: { freshness: ({ json }) => json(200, { ...NO_JOB, has_job: true, active: ACTIVE }) } });
  try {
    const line = page.locator('aside.genie [data-build-status]');
    await line.waitFor({ timeout: 20000 });
    assert.match(await line.innerText(), /Step 2 of 5: Running the use case/, 'the panel says which build step is running');
    assert.equal(await page.locator('aside.genie .g-h + [data-build-status]').count(), 1, 'the line sits right under the panel header');
  } finally {
    await context.close();
  }
});

test('REQ-092: after a build finishes, the Genie panel on first load says how the latest run ended', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { genie: 'open', routes: { freshness: ({ json }) => json(200, { ...NO_JOB, has_job: true, last_run: LAST, last_success: LAST }) } });
  try {
    const line = page.locator('aside.genie [data-build-status]');
    await line.waitFor({ timeout: 20000 });
    assert.match(await line.innerText(), /^Latest run/, 'the panel says how the latest run ended');
  } finally {
    await context.close();
  }
});
