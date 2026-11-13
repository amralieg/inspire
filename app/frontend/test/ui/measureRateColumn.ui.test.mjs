import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onMoneyPart, openUi, profileAt, stubMoney as stub } from './uiSupport.mjs';
import { LIVE_RATES, MONEY_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const PREVIEW = { rows: [{ stake: 120, currency: 'AED' }] };

async function openMeasure() {
  const calls = { preview: [], currency: [], describe: [] };
  const ui = await openUi('wizard', ME, '', {
    init: async (page) => {
      await profileAt([], MONEY_PROFILE)(page);
      await stub('currency-rates', () => LIVE_RATES, calls.currency)(page);
      await stub('value-preview', () => PREVIEW, calls.preview)(page);
    },
  });
  await goToStep(ui.page, 'Measure');
  await ui.page.locator('[data-money-rule-editor]').waitFor({ timeout: 15000 });
  return ui;
}

const errorText = (page) => page.locator('[data-money-error]').innerText().catch(() => '');

test('a column rate is read from a rate column on each row, and the currency column is pre-filled from the table; the rule needs both columns before it saves (REQ-103)', async () => {
  const ui = await openMeasure();
  const { page } = ui;
  try {
    await onMoneyPart(page, 'currency');
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    await page.locator('[data-money-rate-source="column"]').check({ force: true });
    assert.equal(await page.locator('[data-money-rate-currency-column]').inputValue(), 'currency', 'the table\'s currency column is pre-filled');
    assert.equal(await page.locator('[data-money-rate-column]').inputValue(), '', 'the rate column is not guessed');
    await page.waitForFunction(() => /The rate column is the name of a column/.test(document.querySelector('[data-money-error]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.locator('[data-money-rates]').count(), 0, 'no typed rate table in the column mode');

    await page.locator('[data-money-rate-column]').selectOption('unit_price');
    await page.waitForFunction(() => !/The rate column is the name/.test(document.querySelector('[data-money-error]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await page.locator('[data-money-sentence]').innerText(), /converted to AED at the rate in unit price on its own row/);

    await page.locator('[data-money-rate-currency-column]').selectOption('');
    await page.waitForFunction(() => /Pick the currency column/.test(document.querySelector('[data-money-error]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await errorText(page), /Pick the currency column/, 'a rate column with no currency column does not save');
  } finally {
    await page.context().close();
  }
});
