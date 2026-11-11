import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, until } from './harness.mjs';

const WAITING = {
  state: 'waiting_for_access',
  message: 'This App is waiting for access to its data. Your data owner needs to grant the App access; the exact grant is under Details.',
  tables: ['main.pricing.items'],
  detail: "[PERMISSION_DENIED] User does not have SELECT on Table 'main.pricing.items'.",
};
const waitingPage = (state) => ({ json }) => (state.waiting ? json(200, WAITING) : json(200, null));

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

const view = (page) => page.locator('[data-waiting-for-access]');

async function assertWaitingView(page) {
  await view(page).waitFor({ timeout: 15000 });
  const text = await view(page).innerText();
  assert.match(text, /This App is waiting for access to its data/);
  assert.match(text, /your data owner/);
  assert.doesNotMatch(text, /@/, 'no internal email');
  assert.equal(await page.locator('[data-card]').count(), 0, 'the page content is replaced, not shown beside the view');
  assert.equal(await page.getByRole('button', { name: 'Check again' }).count(), 1);
  assert.equal(await page.locator('[data-waiting-details]').count(), 1, 'the tables sit under Details');
}

test('the Dashboard shows the one waiting view in place of the page when the App cannot read its data, and Check again recovers', async () => {
  const state = { waiting: true, asks: 0 };
  const { page, context } = await openApp(browser, served.base, appInfo({}), {
    ready: '[data-waiting-for-access], .kpi-v, .hcard',
    routes: { page: ({ json }) => { state.asks += 1; return state.waiting ? json(200, WAITING) : json(200, { kpis: {}, charts: {}, tables: {}, errors: {} }); } },
  });
  try {
    await assertWaitingView(page);
    state.waiting = false;
    await page.getByRole('button', { name: 'Check again' }).click();
    await until(async () => (await view(page).count()) === 0, 15000);
    await page.locator('[data-page-section]').first().waitFor({ timeout: 15000 });
    assert.ok(await page.locator('[data-page-section]').count() > 0, 'the page content returns after Check again');
  } finally {
    await context.close();
  }
});

test('the Work section shows the same waiting view in place of its content', async () => {
  const state = { waiting: true };
  const { page, context } = await openApp(browser, served.base, appInfo({}), {
    hash: '#/n01_u05/work', ready: '[data-waiting-for-access]', routes: { page: waitingPage(state), my_work: ({ json }) => json(200, WAITING) },
  });
  try {
    await assertWaitingView(page);
  } finally {
    await context.close();
  }
});
