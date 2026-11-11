import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };

test('the Measure step shows how each total is counted and changes the rule in plain words', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    const editor = page.locator('[data-money-rule-editor]');
    await editor.waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-money-formula]').first().innerText(), /^Stake = /);
    assert.match(await editor.locator('[data-money-sentence]').innerText(), /totalled on its own/);
    await page.locator('[data-money-mode="convert"]').check();
    await page.locator('[data-money-base]').fill('USD');
    await page.locator('[data-money-rate-code]').first().fill('AED');
    await page.locator('[data-money-rate]').first().fill('0.27');
    await page.waitForFunction(() => /converted to USD/.test(document.querySelector('[data-money-sentence]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await editor.locator('[data-money-sentence]').innerText(), /1 AED = 0\.27 USD/);
    assert.equal(await page.locator('[data-money-error]').count(), 0, 'a complete rate is not refused');
  } finally {
    await page.context().close();
  }
});

test('a converted rule with a bad base says so in the Measure step', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-rule-editor]').waitFor({ timeout: 15000 });
    await page.locator('[data-money-mode="convert"]').check();
    await page.locator('[data-money-base]').fill('dollars');
    await page.locator('[data-money-rate-code]').first().fill('AED');
    await page.locator('[data-money-rate]').first().fill('0.27');
    await page.waitForSelector('[data-money-error]', { timeout: 15000 });
    assert.match(await page.locator('[data-money-error]').innerText(), /base currency is a three-letter code/);
  } finally {
    await page.context().close();
  }
});
