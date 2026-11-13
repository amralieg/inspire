import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_RATES, MONEY_PROFILE } from './implementFixtures.js';
import { closeBrowser, goToStep, onStep, openUi, profileAt, stubMoney } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const parts = (page) => page.locator('[data-money-part]').evaluateAll((els) => els.map((e) => e.dataset.moneyPart));

test('Measure: a reporting currency asks for rates, Off skips every money decision, saves Off, and Next continues to Run it', async () => {
  const calls = { currency: [] };
  const ui = await openUi('wizard', ME, '', {
    init: async (page) => {
      await profileAt([], MONEY_PROFILE)(page);
      await stubMoney('currency-rates', () => LIVE_RATES, calls.currency)(page);
      await stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(page);
    },
  });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-rule-editor]').waitFor({ timeout: 15000 });
    while (!(await page.locator('[data-money-currency-mode]').first().isVisible())) await page.locator('[data-money-next]').click();
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    await page.locator('[data-money-base]').fill('USD');
    await page.locator('[data-money-base]').blur();
    await page.locator('[data-money-rate-row="EUR"]').waitFor({ timeout: 15000 });
    assert.ok(calls.currency.length >= 1, 'the reporting currency asked for its rates');

    while (!(await page.locator('[data-money-off]').isVisible())) await page.locator('[data-money-next]').click();
    assert.equal(await page.locator('[data-money-rule-editor] [data-money-method]').count(), 0, 'Off is alone on its decision, not with the method');
    await page.locator('[data-money-off]').check();

    assert.equal(await page.locator('[data-money-error]').count(), 0, 'Off raises no rate or currency problem');
    assert.equal(await page.locator('[data-money-off]').isChecked(), true, 'Off stays checked');
    await goToStep(page, 'Run it');
    await onStep(page, 'Run it');

    await goToStep(page, 'Measure');
    assert.equal(await page.locator('[data-money-off]').isChecked(), true, 'Off is saved: it is still on when Measure opens again');
    assert.equal(await page.locator('[data-money-part="method"]').count(), 0, 'the money decisions are skipped while Off is saved');
    assert.ok((await parts(page)).includes('off'), 'the Off decision is on the Measure stepper');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
