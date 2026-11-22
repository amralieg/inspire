import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, profileAt, stubMoney } from './uiSupport.mjs';
import { LIVE_RATES, MONEY_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const ORDER = ['currency', 'window', 'off', 'kpi', 'holdout'];
const openPart = (page) => page.locator(`li[data-money-current] [data-money-part]`).getAttribute(`data-money-part`);
// The same stubs the measure rule test uses: a table with an amount and a currency column, and canned rates and previews.
const PREVIEW = { rows: [{ stake: 100, currency: 'AED' }, { stake: 50, currency: 'USD' }, { stake: 20, currency: 'EUR' }] };
const DESCRIBED = { value: { method: 'equation', expression: 'quantity * unit_price - discount', currency_column: 'currency' }, explanation: 'Units times price, less discount.' };
const withStubs = async (page) => {
  await profileAt([], MONEY_PROFILE)(page);
  await stubMoney('currency-rates', () => LIVE_RATES, [])(page);
  await stubMoney('value-preview', () => PREVIEW, [])(page);
  await stubMoney('describe-value', () => DESCRIBED, [])(page);
};
const summaryOf = (page, part) => page.locator(`[data-money-part="${part}"] [data-fold-line]`).textContent();
const isVisible = (page, sel) => page.locator(sel).evaluateAll((els) => els.some((e) => e.getClientRects().length > 0));

test('Value at stake opens the first section, folds each section into a summary on Next, and the default rule needs no edit', async () => {
  const ui = await openUi('wizard', ME, '', { init: withStubs });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    assert.equal(await openPart(page), 'currency', 'the first section is open');
    assert.equal(await page.locator('[data-money-summary]').count(), 0, 'no section is folded yet');
    assert.equal(await page.locator('[data-money-error]').count(), 0, 'the default rule has no error');
    for (const [i, part] of ORDER.entries()) {
      assert.equal(await openPart(page), part, `${part} is open`);
      if (part === 'holdout') break;
      assert.equal(await page.locator('[data-money-error]').count(), 0, `${part} shows no error with the defaults`);
      await page.locator('[data-money-next]').click();
      assert.match(await summaryOf(page, part), /\S/, `${part} folds into a one-line summary`);
      assert.equal(await openPart(page), ORDER[i + 1], `Next opens ${ORDER[i + 1]}`);
    }
    assert.match(await summaryOf(page, 'currency'), /USD|each record/, 'the currency summary shows the default currency');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the currency and periods fields are editable dropdowns with defaults and a plain explanation', async () => {
  const ui = await openUi('wizard', ME, '', { init: withStubs });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    assert.equal(await openPart(page), 'currency');
    await page.locator('[data-money-next]').click();
    assert.equal(await openPart(page), 'window');
    const window = page.locator('[data-money-window]');
    assert.equal(await window.getAttribute('list'), 'money-window-choices');
    assert.equal(await window.inputValue(), '', 'empty means every closed period');
    assert.ok(await isVisible(page, 'text=How many past periods to add up. All adds every closed period; 12 means the last 12 months.'), 'the plain sentence shows');
  } finally {
    await ui.close();
  }
});
