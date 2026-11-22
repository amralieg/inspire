// REQ-265 (D-AUTO close the gains-without-sign risk): Gains only with no sign picked stops the build with a plain reason on Measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, closeValueDialog, goToStep, onMoneyPart, openMeasureSettings, openUi, toSummary, profileAt, stubMoney as stub } from './uiSupport.mjs';
import { MONEY_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const REASON = /Gains only needs a sign: name the column whose positive values are gains/;

test('REQ-265: Gains only with no sign stops the build, names the reason in plain words, and clears once a sign is named (must-exclude: a build with no sign)', async () => {
  const ui = await openUi('wizard', ME, '', {
    init: async (page) => {
      await profileAt([], MONEY_PROFILE)(page);
      await stub('value-preview', () => ({ rows: [{ stake: 100, currency: 'AED' }] }), [])(page);
      await stub('currency-rates', () => ({ base: 'AED', currencies: [{ code: 'AED', records: 1 }], rates: {}, sources: {}, missing: [], offline: false, message: '' }), [])(page);
    },
  });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await onMoneyPart(page, 'direction');
    await page.locator('input[name="measure-direction"][data-money-rule-kind="gains"]').check({ force: true });
    await page.locator('[data-money-next]').click();
    await onMoneyPart(page, 'sign');
    // Walk the Measure decisions to the end, then close the value dialog (REQ-457: Measure is not a step): the last step names the reason.
    for (let i = 0; i < 10 && await page.locator('[data-money-next]').count(); i += 1) await page.locator('[data-money-next]').first().click();
    await closeValueDialog(page);
    await toSummary(page);
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await page.getByText(REASON).first().waitFor({ timeout: 15000 });
    assert.equal(await page.getByText(REASON).first().isVisible(), true, 'the build refuses with the plain reason on screen');
    // REQ-457: Build is on the last step now, so the refusal is the build not starting (no job), not a disabled Build-now button.
    assert.equal(ui.made.jobs.length, 0, 'no build starts while the sign is missing (must-exclude)');
    await openMeasureSettings(page, 'sign');
    await page.locator('[data-money-sign-kind="status"]').check();
    await page.locator('[data-money-sign-status-column]').fill('channel');
    await page.locator('[data-money-sign-value]').fill('gain');
    await page.waitForFunction(() => !document.querySelector('[data-money-sign-needed]'), null, { timeout: 15000 });
    assert.equal(await page.getByText(REASON).count(), 0, 'the reason clears once a sign is named');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
