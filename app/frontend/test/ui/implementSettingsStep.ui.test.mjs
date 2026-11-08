import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { closeBrowser, dataToResults, onStep, openUi, goToStep } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const NO_SETTINGS = { ...HARNESS_USE_CASE, genie_instruction: '' };
const steps = (page) => page.locator('ol li').allTextContents();

const WITH_APP = ['1. Delivery consumption', '2. Data', '3. MVP Test Run', '4. Results', '5. App placement', '6. App access', '7. App look', '8. Settings', '9. Vibes', '10. Summary'];

test('a use case with no settings still has the Settings step, holding only Team capacity, and unticking the App hides the App steps', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase: NO_SETTINGS });
  const { page } = ui;
  try {
    await onStep(page, 'Delivery consumption');
    assert.deepEqual(await steps(page), WITH_APP);
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    assert.deepEqual(await steps(page), ['1. Delivery consumption', '2. Data', '3. MVP Test Run', '4. Results', '5. Settings', '6. Vibes', '7. Summary']);
    await goToStep(page, 'Data');
    await dataToResults(page);
    assert.equal(await page.getByRole('group', { name: 'Team capacity' }).count(), 0, 'Team capacity is no longer on Results (must-exclude)');
    await goToStep(page, 'Settings');
    await page.getByRole('group', { name: 'Team capacity' }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case with settings keeps the Settings step, with Team capacity, right before Vibes', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await onStep(page, 'Delivery consumption');
    assert.deepEqual(await steps(page), WITH_APP);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Settings link lands on Settings with or without use case settings', async () => {
  for (const useCase of [NO_SETTINGS, HARNESS_USE_CASE]) {
    const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase }, '&step=settings');
    try {
      await onStep(ui.page, 'Settings');
      await ui.page.getByRole('group', { name: 'Team capacity' }).waitFor();
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
