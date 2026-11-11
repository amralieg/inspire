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

test('Closed periods and Statuses are visible fields, and a rule typed into them shows in the Measure step', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-rule-editor]').waitFor({ timeout: 15000 });
    await page.getByText('Rows and how they add up', { exact: true }).click();
    for (const field of ['[data-money-window]', '[data-money-statuses]']) {
      const box = await page.locator(field).boundingBox();
      assert.ok(box && box.width > 100 && box.height >= 20, `${field} is a visible input box`);
      const border = await page.locator(field).evaluate((el) => getComputedStyle(el).borderTopWidth);
      assert.notEqual(border, '0px', `${field} has a border, so it is not blank space`);
    }
    await page.locator('[data-money-window]').fill('3');
    await page.locator('[data-money-statuses]').fill('used');
    await page.locator('[data-money-status-column]').fill('status');
    await page.waitForFunction(() => /over the last 3 closed periods/.test(document.querySelector('[data-money-sentence]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await page.locator('[data-money-sentence]').innerText(), /Only rows whose status is used count/);
    assert.equal(await page.locator('[data-money-error]').count(), 0, 'a complete window and status list is not refused');
  } finally {
    await ui.close();
  }
});

test('the Measure step asks one decision on the page: how money is counted', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-rule-editor]').waitFor({ timeout: 15000 });
    const visible = await page.locator('[data-money-rule-editor] input:visible, [data-money-rule-editor] select:visible').count();
    const groups = await page.locator('[data-money-rule-editor] fieldset:visible').count();
    assert.equal(groups, 1, 'one choice group is on the page');
    assert.equal(visible, 3, 'the page shows the three ways to count money, and nothing else until the person opens the rule details');
  } finally {
    await ui.close();
  }
});
