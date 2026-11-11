import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { appInfo, openApp, pageData, serveDist, TABLE } from './harness.mjs';

const SHOTS = '/tmp/cc_inspire/live/stake';
let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); mkdirSync(SHOTS, { recursive: true }); });
after(async () => { await browser?.close(); served?.close(); });

const LEFT = '2 rows without a date and 1 row from the running month were left out';
const BASIS = 'converted to USD at the rates typed in';
const MONEY = { rule: { currency: 'per_currency' }, saved: false, name: 'money_rule' };

function pageRoute(extra = {}) {
  return ({ json }) => {
    const data = pageData({});
    const kpis = Object.fromEntries(Object.entries(data.kpis).map(([id, value]) => [id, id === 'total_loss'
      ? { ...value, basis: extra.basis || '', left_out: { undated: 2, running: 1, unrated: 0, text: LEFT } } : value]));
    return json(200, { ...data, kpis, errors: {}, ...(extra.note ? { money_note: extra.note } : {}) });
  };
}

function settingsRoute(record, { money = MONEY } = {}) {
  return ({ route, json }) => {
    if (route.request().method() === 'POST') {
      record.saved = route.request().postDataJSON();
      return json(200, { settings: [], history: [], editable: true, why: '', can_run: false, job: false, money: { ...MONEY, rule: record.saved.rule, saved: true } });
    }
    return json(200, { settings: [], history: [], editable: true, why: '', can_run: false, job: false, money });
  };
}

test('a money KPI shows the converted basis and the left-out line under its value, at 1280x800', async () => {
  const info = appInfo({}, 1, { ...TABLE }, 'example_page.json');
  const { page, context } = await openApp(browser, served.base, info, {
    width: 1280, height: 800, routes: { page: pageRoute({ basis: BASIS }) }, hash: '#/n01_u05', ready: '.kpi-v',
  });
  await page.waitForSelector('.kpi-s');
  const line = page.locator('.kpi-s', { hasText: 'left out' }).first();
  assert.match(await line.innerText(), /2 rows without a date/);
  assert.match(await page.locator('.kpi-s', { hasText: BASIS }).first().innerText(), /converted to USD at the rates typed in/);
  await page.screenshot({ path: `${SHOTS}/kpi-left-out-1280x800.png` });
  await context.close();
});

test('the Measurement editor sets a converted rule with a window, previews it, and saves it, at 1280x800', async () => {
  const info = appInfo({ use_case_owners: { 'n01_u05': ['owner@example.com'] } }, 1, { ...TABLE }, 'example_page.json');
  const record = { saved: null };
  const previews = [];
  const { page, context } = await openApp(browser, served.base, info, {
    width: 1280, height: 800,
    routes: {
      settings: settingsRoute(record),
      'money/preview': ({ route, json }) => {
        previews.push(route.request().postDataJSON());
        return json(200, { totals: [{ currency: 'USD', now: 1234 }], top: [{ currency: 'USD', amount: 500 }], left_out: { text: LEFT }, rule: { base: 'USD' } });
      },
      'money/rule': settingsRoute(record),
    },
    hash: '#/n01_u05/settings', ready: '[data-money-rule], [data-kpi-gap], .setting-group, body',
  });
  await page.waitForSelector('[data-money-rule]', { timeout: 15000 });
  await page.locator('[data-money-rule]').scrollIntoViewIfNeeded();
  await page.locator('[data-money-mode="convert"]').check();
  await page.locator('[data-money-base]').fill('USD');
  await page.locator('[data-money-window]').fill('12');
  await page.locator('[data-money-rate-code]').first().fill('AED');
  await page.locator('[data-money-rate]').first().fill('0.27');
  await page.locator('[data-money-preview-button]').click();
  await page.waitForSelector('[data-money-preview]');
  assert.match(await page.locator('[data-money-preview]').innerText(), /USD 1,234/);
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].rule, { currency: 'convert', base: 'USD', rates: { AED: 0.27 }, window: { periods: 12 } });
  await page.screenshot({ path: `${SHOTS}/measurement-editor-preview-1280x800.png` });
  await page.locator('[data-money-save]').click();
  await page.waitForFunction(() => Boolean(document.querySelector('[data-money-sentence]')));
  assert.equal(record.saved.rule.base, 'USD');
  await context.close();
});

test('a converted rule with a bad base is refused in words and nothing is saved, at 1280x800', async () => {
  const info = appInfo({ use_case_owners: { 'n01_u05': ['owner@example.com'] } }, 1, { ...TABLE }, 'example_page.json');
  const record = { saved: null };
  const { page, context } = await openApp(browser, served.base, info, {
    width: 1280, height: 800, routes: { settings: settingsRoute(record), 'money/rule': settingsRoute(record) },
    hash: '#/n01_u05/settings', ready: 'body',
  });
  await page.waitForSelector('[data-money-rule]', { timeout: 15000 });
  await page.locator('[data-money-mode="convert"]').check();
  await page.locator('[data-money-base]').fill('dollars');
  await page.locator('[data-money-rate-code]').first().fill('AED');
  await page.locator('[data-money-rate]').first().fill('0.27');
  await page.locator('[data-money-save]').click();
  await page.waitForSelector('[data-money-error]');
  assert.match(await page.locator('[data-money-error]').innerText(), /base currency is a three-letter code/);
  assert.equal(record.saved, null, 'nothing is sent when the rule is refused');
  await page.screenshot({ path: `${SHOTS}/measurement-editor-refused-1280x800.png` });
  await context.close();
});

test('the build-level money fields are locked with the rebuild note, Off and the window stay editable, at 1280x800', async () => {
  const info = appInfo({ use_case_owners: { 'n01_u05': ['owner@example.com'] } }, 1, { ...TABLE }, 'example_page.json');
  const money = { rule: { currency: 'convert', base: 'USD', rate_table: { table: 'main.fx.rates', currency_column: 'from_code', base_column: 'to_code', date_column: 'rate_date', rate_column: 'rate' }, statuses: ['used'], rule: 'net', per: 'group', group_column: 'channel' }, saved: false, name: 'money_rule' };
  const record = { saved: null };
  const { page, context } = await openApp(browser, served.base, info, {
    width: 1280, height: 800, routes: { settings: settingsRoute(record, { money }), 'money/rule': settingsRoute(record) },
    hash: '#/n01_u05/settings', ready: 'body',
  });
  await page.waitForSelector('[data-money-rule]', { timeout: 15000 });
  assert.equal(await page.locator('[data-money-rebuild]').count() >= 3, true, 'statuses, the rule and the group carry the rebuild note');
  assert.equal(await page.locator('[data-money-statuses]').isDisabled(), true);
  assert.equal(await page.locator('[data-money-window]').isDisabled(), false, 'the window is the owner\'s to change');
  assert.equal(await page.locator('[data-money-off]').isEnabled(), true, 'Off is the owner\'s to change');
  await page.locator('[data-money-rule]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/measurement-build-fields-locked-1280x800.png` });
  await context.close();
});

const FALLBACK = 'The saved value uses amount, which the table no longer has, so the totals are Genie estimates until the value is changed.';

test('when a saved money value lost its column the App says so above the money KPIs, at 1280x800', async () => {
  const info = appInfo({}, 1, { ...TABLE }, 'example_page.json');
  const { page, context } = await openApp(browser, served.base, info, {
    width: 1280, height: 800, routes: { page: pageRoute({ note: FALLBACK }) }, hash: '#/n01_u05', ready: '.kpi-v',
  });
  await page.waitForSelector('[data-money-note]', { timeout: 15000 });
  assert.equal(await page.locator('[data-money-note]').innerText(), FALLBACK);
  await context.close();
});

test('a page with no money note shows no money note line', async () => {
  const info = appInfo({}, 1, { ...TABLE }, 'example_page.json');
  const { page, context } = await openApp(browser, served.base, info, {
    width: 1280, height: 800, routes: { page: pageRoute({}) }, hash: '#/n01_u05', ready: '.kpi-v',
  });
  await page.waitForSelector('.kpi-v', { timeout: 15000 });
  assert.equal(await page.locator('[data-money-note]').count(), 0);
  await context.close();
});
