import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { closeBrowser, dataToResults, onStep, openUi, customize } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const NO_SETTINGS = { ...HARNESS_USE_CASE, genie_instruction: '' };
const steps = (page) => page.locator('ol li').allTextContents();

async function toDelivery(page) {
  await onStep(page, 'Choose');
  await customize(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await onStep(page, 'Data');
  await dataToResults(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await onStep(page, 'Delivery');
}

test('a first build of a use case with no settings shows 9 steps ending in Vibes, and no Settings step', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase: NO_SETTINGS });
  const { page } = ui;
  try {
    await toDelivery(page);
    assert.deepEqual(await steps(page), ['1. Choose', '2. Data', '3. First run', '4. Results', '5. Delivery', '6. App placement', '7. App access', '8. App look', '9. Vibes']);
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    assert.deepEqual(await steps(page), ['1. Choose', '2. Data', '3. First run', '4. Results', '5. Delivery', '6. Vibes']);
    assert.equal(await page.getByText('This use case has no settings yet', { exact: false }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case with settings keeps the Settings step right before Vibes', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await toDelivery(page);
    assert.deepEqual(await steps(page), ['1. Choose', '2. Data', '3. First run', '4. Results', '5. Delivery', '6. App placement', '7. App access', '8. App look', '9. Settings', '10. Vibes']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Settings link lands on Vibes when the use case has no settings, and on Settings when it has some', async () => {
  const none = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase: NO_SETTINGS }, '&step=settings');
  try {
    await onStep(none.page, 'Vibes');
    assert.equal(await none.page.locator('ol li', { hasText: 'Settings' }).count(), 0);
    assert.deepEqual(none.pageErrors, []);
  } finally {
    await none.close();
  }
  const some = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } }, '&step=settings');
  try {
    await onStep(some.page, 'Settings');
    assert.deepEqual(some.pageErrors, []);
  } finally {
    await some.close();
  }
});
