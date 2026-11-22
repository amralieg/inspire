import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onMoneyPart, openUi, profileAt, stubMoney as stub } from './uiSupport.mjs';
import { LIVE_RATES, MONEY_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const OFFLINE_RATES = {
  ...LIVE_RATES, sources: { USD: 'average', EUR: 'average' }, offline: true,
  message: 'No internet: every rate is the saved historical average (fetch failed).',
};
const DESCRIBED = { value: { method: 'equation', expression: 'quantity * unit_price - discount', currency_column: 'currency' }, explanation: 'Units times price, less discount.' };
const PREVIEW = (currency) => ({ rows: [{ stake: 120, currency }, { stake: 120, currency }, { stake: 120, currency }] });

function plannedStub(path, plan, calls) {
  return async (page) => {
    let n = 0;
    await page.route(`**/api/money/${path}`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body);
      const step = plan(n, body);
      n += 1;
      if (step.delay) await new Promise((done) => setTimeout(done, step.delay));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(step.answer) });
    });
  };
}

async function openMeasure({ rates = LIVE_RATES, calls = { preview: [], currency: [], describe: [] }, init = null } = {}) {
  const ui = await openUi('wizard', ME, '', {
    init: async (page) => {
      await profileAt([], MONEY_PROFILE)(page);
      await stub('currency-rates', () => rates, calls.currency)(page);
      await stub('value-preview', () => PREVIEW('USD'), calls.preview)(page);
      await stub('describe-value', () => DESCRIBED, calls.describe)(page);
      if (init) await init(page);
    },
  });
  await goToStep(ui.page, 'Measure');
  await ui.page.locator('[data-money-rule-editor]').waitFor({ timeout: 15000 });
  return { ...ui, calls };
}

test('the reporting currency is the data main currency, its rates show today’s source, and an edited rate is saved as typed', async () => {
  const ui = await openMeasure();
  const { page } = ui;
  try {
    await onMoneyPart(page, 'currency');
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    assert.equal(await page.locator('[data-money-base]').inputValue(), 'AED');
    const usd = page.locator('[data-money-rate-row="USD"]');
    assert.match(await usd.locator('[data-money-rate-source]').innerText(), /today/);
    await usd.locator('[data-money-rate]').fill('0.3');
    await page.waitForFunction(() => /1 USD = 0\.3 AED/.test(document.querySelector('[data-money-sentence]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await usd.locator('[data-money-rate-source]').innerText(), /typed in/);
  } finally {
    await page.context().close();
  }
});

test('with no internet the rates are the saved averages, and one line says so', async () => {
  const ui = await openMeasure({ rates: OFFLINE_RATES });
  const { page } = ui;
  try {
    await onMoneyPart(page, 'currency');
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    // The rates arrive after the Convert pick under load; wait for the notice rather than read it at once.
    await page.locator('[data-money-rates-notice]').waitFor({ timeout: 30000 });
    assert.match(await page.locator('[data-money-rates-notice]').innerText(), /No internet: every rate is the saved historical average/);
    assert.match(await page.locator('[data-money-rate-row="EUR"] [data-money-rate-source]').innerText(), /ECB average, 2025/);
  } finally {
    await page.context().close();
  }
});

test('a slow rates reply for the same reporting currency does not overwrite a rate typed while it was on its way', async () => {
  const calls = { preview: [], currency: [], describe: [] };
  const ui = await openMeasure({ calls, init: plannedStub('currency-rates', (n) => (n <= 1 ? { answer: LIVE_RATES } : { answer: LIVE_RATES, delay: 2000 }), calls.currency) });
  const { page } = ui;
  try {
    await onMoneyPart(page, 'currency');
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').waitFor({ timeout: 15000 });
    await page.locator('[data-money-base]').blur();
    await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').fill('0.5');
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').inputValue(), '0.5', 'the typed rate survives a reply for the same base');
    assert.match(await page.locator('[data-money-sentence]').innerText(), /1 EUR = 0\.5 AED/);
  } finally {
    await page.context().close();
  }
});

test('a rate typed for one reporting currency is dropped when the reporting currency changes, and never saved as the new base rate', async () => {
  const calls = { preview: [], currency: [], describe: [] };
  const eurBase = { base: 'EUR', currencies: [{ code: 'EUR', records: 4 }, { code: 'AED', records: 40 }], rates: { AED: 0.24 }, sources: { AED: 'today' }, missing: [], as_of: '2026-11-11', offline: false, message: '' };
  // The first reply is the rates read on open; choosing Convert reads nothing new, so the base change is the second reply.
  const ui = await openMeasure({ calls, init: plannedStub('currency-rates', (n) => (n <= 0 ? { answer: LIVE_RATES } : { answer: eurBase }), calls.currency) });
  const { page } = ui;
  try {
    await onMoneyPart(page, 'currency');
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').waitFor({ timeout: 15000 });
    await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').fill('4.10');
    await page.locator('[data-money-base]').fill('EUR');
    await page.locator('[data-money-base]').blur();
    await page.waitForFunction(() => document.querySelector('[data-money-base]')?.value === 'EUR' && /dropped/.test(document.querySelector('[data-money-rates-notice]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').inputValue(), '1', 'EUR is the reporting currency, so its rate is 1');
    assert.equal(await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').isDisabled(), true);
    assert.doesNotMatch(await page.locator('[data-money-sentence]').innerText(), /EUR = 4\.1 /, 'the typed 4.10 is never saved as the EUR rate');
    assert.match(await page.locator('[data-money-rates-notice]').innerText(), /Your typed rate for EUR was for the previous reporting currency, so it was dropped/);
  } finally {
    await page.context().close();
  }
});

