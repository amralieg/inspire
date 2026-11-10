import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { appInfo, openApp, pageData, serveDist, TABLE } from './harness.mjs';

const SHOTS = '/tmp/cc_inspire/live/stake';
const DUPLICATE = '2 rows without a date and 1 row from the running month were left out; 1 date has more than one rate, and the latest loaded was used';
let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); mkdirSync(SHOTS, { recursive: true }); });
after(async () => { await browser?.close(); served?.close(); });

function pageRoute() {
  return ({ json }) => {
    const data = pageData({});
    const kpis = Object.fromEntries(Object.entries(data.kpis).map(([id, value]) => [id, id === 'total_loss'
      ? { ...value, left_out: { undated: 2, running: 1, unrated: 0, duplicated: 1, text: DUPLICATE } } : value]));
    return json(200, { ...data, kpis, errors: {} });
  };
}

test('Off shows no money card, at 1280x800', async () => {
  const info = appInfo({}, 1, { ...TABLE, money: { currency: 'per_currency', off: true } }, 'example_page.json');
  const { page, context } = await openApp(browser, served.base, info, { width: 1280, height: 800, routes: { page: pageRoute() }, hash: '#/n01_u05', ready: 'body' });
  await page.waitForTimeout(1500);
  const labels = await page.locator('.kpi-l').allInnerTexts();
  assert.equal(labels.some((t) => /loss/i.test(t) && /total|discount|money|revenue/i.test(t)), false, `money card still shown: ${labels.join(' | ')}`);
  await page.screenshot({ path: `${SHOTS}/off-no-money-cards-1280x800.png` });
  await context.close();
});

test('the duplicate-rate note shows under the money KPI, at 1280x800', async () => {
  const info = appInfo({}, 1, { ...TABLE }, 'example_page.json');
  const { page, context } = await openApp(browser, served.base, info, { width: 1280, height: 800, routes: { page: pageRoute() }, hash: '#/n01_u05', ready: '.kpi-v' });
  await page.waitForSelector('.kpi-s', { timeout: 15000 });
  const note = page.locator('.kpi-s', { hasText: 'more than one rate' }).first();
  assert.match(await note.innerText(), /the latest loaded was used/);
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/duplicate-rate-note-1280x800.png` });
  await context.close();
});

test('the preview shows the largest rows as a worked example, at 1280x800', async () => {
  const info = appInfo({ use_case_owners: { 'n01_u05': ['owner@example.com'] } }, 1, { ...TABLE }, 'example_page.json');
  const routes = {
    settings: ({ json }) => json(200, { settings: [], history: [], editable: true, why: '', can_run: false, job: false,
      money: { rule: { currency: 'convert', base: 'USD', rates: { AED: 0.27 } }, saved: false, name: 'money_rule' } }),
    'money/preview': ({ json }) => json(200, { totals: [{ currency: 'USD', now: 27 }], top: [{ currency: 'AED', amount: 27, raw: 100 }],
      left_out: { text: DUPLICATE }, rule: { base: 'USD' } }),
  };
  const { page, context } = await openApp(browser, served.base, info, { width: 1280, height: 800, routes, hash: '#/n01_u05/settings', ready: 'body' });
  await page.waitForSelector('[data-money-rule]', { timeout: 15000 });
  await page.locator('[data-money-preview-button]').click();
  await page.waitForSelector('[data-money-example]');
  assert.match(await page.locator('[data-money-example]').innerText(), /AED 100 × 0.27 = 27 USD/);
  await page.locator('[data-money-example-title]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/worked-example-preview-1280x800.png` });
  await context.close();
});
