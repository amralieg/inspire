import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, profileAt } from './uiSupport.mjs';
import { GROUPING_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const MONEY_PROFILE = {
  ...GROUPING_PROFILE,
  money_columns: ['order_id', 'quantity', 'unit_price', 'discount', 'amount', 'currency'],
  money_sample: { amount: 'amount', currency: 'currency', status: '', rows: [{ amount: 100, currency: 'AED' }, { amount: 50, currency: 'USD' }, { amount: 20, currency: 'EUR' }] },
};
const LIVE_RATES = {
  base: 'AED', currencies: [{ code: 'AED', records: 40 }, { code: 'USD', records: 9 }, { code: 'EUR', records: 4 }],
  rates: { USD: 0.272294, EUR: 0.2967 }, sources: { USD: 'today', EUR: 'today' }, missing: [], as_of: '2026-11-11', offline: false, message: '',
};
const OFFLINE_RATES = {
  ...LIVE_RATES, sources: { USD: 'average', EUR: 'average' }, offline: true,
  message: 'No internet: every rate is the saved historical average (fetch failed).',
};
const DESCRIBED = { value: { method: 'equation', expression: 'quantity * unit_price - discount', currency_column: 'currency' }, explanation: 'Units times price, less discount.' };
const PREVIEW = (currency) => ({ rows: [{ stake: 120, currency }, { stake: 120, currency }, { stake: 120, currency }] });

function stub(path, answerOf, calls) {
  return async (page) => {
    await page.route(`**/api/money/${path}`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answerOf(body)) });
    });
  };
}

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

test('the Measure step asks how the value of each record is measured, with four choices and no old fields', async () => {
  const ui = await openMeasure();
  const { page } = ui;
  try {
    assert.match(await page.locator('[data-measure-value] legend').innerText(), /How does your business measure the value of each record\?/);
    assert.equal(await page.locator('[data-money-method]').count(), 4);
    assert.equal(await page.locator('[data-money-mode]').count(), 0, 'the old per-currency and convert radios are gone');
    assert.equal(await page.locator('[data-money-more] summary').innerText(), 'More options');
  } finally {
    await page.context().close();
  }
});

test('a fixed amount previews three example rows in the currency it names, and the rule saves that value', async () => {
  const ui = await openMeasure();
  const { page, calls } = ui;
  try {
    await page.locator('[data-money-method="fixed"]').check();
    await page.locator('[data-money-fixed-amount]').fill('120');
    await page.locator('[data-money-value-code]').fill('USD');
    await page.waitForSelector('[data-money-preview-rows] li', { timeout: 15000 });
    assert.equal(await page.locator('[data-money-preview-rows] li').count(), 3);
    assert.equal(await page.locator('[data-money-preview-rows] li').first().innerText(), '120 USD');
    assert.deepEqual(calls.preview.at(-1).value, { method: 'fixed', amount: 120, currency: 'USD' });
  } finally {
    await page.context().close();
  }
});

test('a column value previews the rows of the column picked, with its currency column', async () => {
  const ui = await openMeasure();
  const { page, calls } = ui;
  try {
    await page.locator('[data-money-method="column"]').check();
    await page.locator('[data-money-value-column]').selectOption('amount');
    await page.locator('[data-money-value-currency-by="column"]').check();
    await page.waitForSelector('[data-money-preview-rows] li', { timeout: 15000 });
    assert.deepEqual(calls.preview.at(-1).value, { method: 'column', column: 'amount', currency_column: 'currency' });
  } finally {
    await page.context().close();
  }
});

test('an equation the grammar does not allow is refused on the spot, and a valid one previews its three rows', async () => {
  const ui = await openMeasure();
  const { page, calls } = ui;
  try {
    await page.locator('[data-money-method="equation"]').check();
    await page.locator('[data-money-value-code]').fill('USD');
    await page.locator('[data-money-equation]').fill('quantity ^ 2');
    await page.waitForSelector('[data-money-error]', { timeout: 15000 });
    assert.match(await page.locator('[data-money-error]').innerText(), /adds, subtracts, multiplies and divides column names and numbers/);
    assert.equal(calls.preview.length, 0, 'a refused equation never reaches the warehouse');
    await page.locator('[data-money-equation]').fill('quantity * unit_price - discount');
    await page.waitForSelector('[data-money-preview-rows] li', { timeout: 15000 });
    assert.equal(await page.locator('[data-money-preview-rows] li').count(), 3);
    assert.equal(calls.preview.at(-1).value.expression, 'quantity * unit_price - discount');
  } finally {
    await page.context().close();
  }
});

test('the reporting currency is the data main currency, its rates show today’s source, and an edited rate is saved as typed', async () => {
  const ui = await openMeasure();
  const { page } = ui;
  try {
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
    assert.match(await page.locator('[data-money-rates-notice]').innerText(), /No internet: every rate is the saved historical average/);
    assert.match(await page.locator('[data-money-rate-row="EUR"] [data-money-rate-source]').innerText(), /ECB average, 2025/);
  } finally {
    await page.context().close();
  }
});

test('which movement counts is one plain question, and both gains and losses net inside each total', async () => {
  const ui = await openMeasure();
  const { page } = ui;
  try {
    await page.locator('[data-money-rule-kind="net"]').check();
    await page.waitForFunction(() => /netted/.test(document.querySelector('[data-money-sentence]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.locator('[data-money-rule-kind="net"]').isChecked(), true);
  } finally {
    await page.context().close();
  }
});

test('Describe it: the App proposes the rule from the words, the person sees it with its rows and uses it', async () => {
  const ui = await openMeasure();
  const { page, calls } = ui;
  try {
    await page.locator('[data-money-method="describe"]').check();
    await page.locator('[data-money-describe-text]').fill('each booking loses its price less the discount');
    await page.locator('[data-money-describe-propose]').click();
    await page.waitForSelector('[data-money-describe-proposal]', { timeout: 15000 });
    assert.match(await page.locator('[data-money-describe-rule]').innerText(), /quantity \* unit_price - discount, in the currency of currency/);
    assert.equal(calls.describe.at(-1).text, 'each booking loses its price less the discount');
    assert.ok(calls.describe.at(-1).columns.includes('unit_price'), 'the model is told the table columns');
    assert.deepEqual(calls.preview.at(-1).value, DESCRIBED.value, 'the proposal is previewed on its three rows before it is used');
    await page.locator('[data-money-describe-use]').click();
    await page.waitForSelector('[data-money-preview-rows] li', { timeout: 15000 });
    assert.deepEqual(calls.preview.at(-1).value, { method: 'equation', expression: 'quantity * unit_price - discount', currency_column: 'currency' });
  } finally {
    await page.context().close();
  }
});

test('an equation that names a column the table does not have is refused before it saves, and nothing is saved', async () => {
  const ui = await openMeasure();
  const { page, calls } = ui;
  try {
    await page.locator('[data-money-method="equation"]').check();
    await page.locator('[data-money-value-code]').fill('USD');
    await page.locator('[data-money-equation]').fill('quantity * shipping_fee');
    await page.waitForSelector('[data-money-error]', { timeout: 15000 });
    assert.match(await page.locator('[data-money-error]').innerText(), /The column shipping_fee is not in this table, so the rule cannot use it./);
    assert.equal(calls.preview.length, 0, 'a rule naming a missing column never reaches the warehouse');
    await page.locator('[data-money-equation]').fill('quantity * unit_price');
    await page.waitForSelector('[data-money-preview-rows] li', { timeout: 15000 });
  } finally {
    await page.context().close();
  }
});

test('a slow rates reply does not overwrite a rate the person typed while it was on its way', async () => {
  const calls = { preview: [], currency: [], describe: [] };
  const usdRates = { ...LIVE_RATES, base: 'USD', rates: { AED: 3.6725, EUR: 0.9 }, sources: { AED: 'today', EUR: 'today' } };
  const ui = await openMeasure({ calls, init: plannedStub('currency-rates', (n) => (n === 0 ? { answer: LIVE_RATES } : { answer: usdRates, delay: 2000 }), calls.currency) });
  const { page } = ui;
  try {
    await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').waitFor({ timeout: 15000 });
    await page.locator('[data-money-base]').fill('USD');
    await page.locator('[data-money-base]').blur();
    await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').fill('0.5');
    await page.waitForFunction(() => document.querySelector('[data-money-base]')?.value === 'USD' && /1 EUR = 0\.5 USD/.test(document.querySelector('[data-money-sentence]')?.textContent || ''), null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('[data-money-rate-row="EUR"] [data-money-rate]').inputValue(), '0.5', 'the typed rate survives the reply');
    assert.match(await page.locator('[data-money-sentence]').innerText(), /1 EUR = 0\.5 USD/);
  } finally {
    await page.context().close();
  }
});

test('an older Describe it proposal that answers late does not replace the newer one', async () => {
  const calls = { preview: [], currency: [], describe: [] };
  const first = { value: { method: 'equation', expression: 'quantity * unit_price', currency_column: 'currency' }, explanation: 'first reading' };
  const second = { value: { method: 'equation', expression: 'quantity * discount', currency_column: 'currency' }, explanation: 'second reading' };
  const ui = await openMeasure({ calls, init: plannedStub('describe-value', (n) => (n === 0 ? { answer: first, delay: 2500 } : { answer: second }), calls.describe) });
  const { page } = ui;
  try {
    await page.locator('[data-money-method="describe"]').check();
    await page.locator('[data-money-describe-text]').fill('a booking, two ways');
    await page.locator('[data-money-describe-propose]').click();
    await page.locator('[data-money-describe-propose]').click();
    await page.waitForSelector('[data-money-describe-explanation]', { timeout: 15000 });
    await page.waitForTimeout(3000);
    assert.equal(await page.locator('[data-money-describe-explanation]').innerText(), 'second reading');
    assert.match(await page.locator('[data-money-describe-rule]').innerText(), /quantity \* discount/);
  } finally {
    await page.context().close();
  }
});

test('Gains only is disabled with its reason until a sign is named, and a status sign enables it', async () => {
  const ui = await openMeasure();
  const { page } = ui;
  try {
    assert.equal(await page.locator('[data-money-rule-kind="gains"]').isDisabled(), true);
    assert.match(await page.locator('[data-money-sign-needed]').innerText(), /Gains only needs a sign/);
    await page.locator('[data-money-sign-kind="status"]').check();
    await page.locator('[data-money-sign-status-column]').selectOption('currency');
    await page.locator('[data-money-sign-value]').fill('gain');
    await page.waitForFunction(() => !document.querySelector('[data-money-rule-kind="gains"]')?.disabled, null, { timeout: 15000 });
    assert.equal(await page.locator('[data-money-sign-needed]').count(), 0);
    await page.locator('[data-money-rule-kind="gains"]').check();
    await page.waitForFunction(() => /Only gains count/.test(document.querySelector('[data-money-sentence]')?.textContent || ''), null, { timeout: 15000 });
  } finally {
    await page.context().close();
  }
});
