import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { closeBrowser, dataToResults, onStep, openUi, goToStep, toSummary } from './uiSupport.mjs';
import { CAPACITY_IN_APP } from '../../src/lib/implementWizard.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const NO_SETTINGS = { ...HARNESS_USE_CASE, genie_instruction: '' };
const steps = (page) => page.locator('ol li').allTextContents();

const WITH_APP = ['1. Delivery consumption', '2. Data', '3. MVP Test Run', '4. Results', '5. Measure impact', '6. Keep it fresh', '7. App placement', '8. App access', '9. App look', '10. Settings', '11. Vibes', '12. Summary'];
const NO_SETTINGS_STEPS = WITH_APP.filter((s) => !s.endsWith('Settings')).map((s, i) => `${i + 1}. ${s.replace(/^\d+\. /, '')}`);

test('a use case with no settings has no Settings step, the wizard asks no Team capacity, and Summary says it is set in the App', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase: NO_SETTINGS });
  const { page } = ui;
  try {
    await onStep(page, 'Delivery consumption');
    assert.deepEqual(await steps(page), NO_SETTINGS_STEPS);
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    assert.deepEqual(await steps(page), ['1. Delivery consumption', '2. Data', '3. MVP Test Run', '4. Results', '5. Measure impact', '6. Keep it fresh', '7. Vibes', '8. Summary']);
    await goToStep(page, 'Data');
    await dataToResults(page);
    for (const label of ['Results', 'Measure impact', 'Keep it fresh', 'Vibes']) {
      await goToStep(page, label);
      assert.equal(await page.getByRole('group', { name: 'Team capacity' }).count(), 0, `no Team capacity on ${label} (must-exclude)`);
    }
    await toSummary(page);
    const row = page.locator('[data-picked-row="capacity"]');
    assert.equal(await row.locator('[data-picked-value]').textContent(), CAPACITY_IN_APP);
    assert.equal(await row.locator('[data-picked-change]').count(), 0, 'there is no wizard step to change it on');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case with settings keeps the Settings step right before Vibes, with no Team capacity on it', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await onStep(page, 'Delivery consumption');
    assert.deepEqual(await steps(page), WITH_APP);
    await goToStep(page, 'Settings');
    assert.equal(await page.getByRole('group', { name: 'Team capacity' }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Settings link lands on Settings when the use case has settings, and on Vibes when it has none', async () => {
  for (const [useCase, lands] of [[NO_SETTINGS, 'Vibes'], [HARNESS_USE_CASE, 'Settings']]) {
    const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase }, '&step=settings');
    try {
      await onStep(ui.page, lands);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
