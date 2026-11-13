import test from 'node:test';
import assert from 'node:assert/strict';
import { PER_USER_GUIDE } from '../../src/lib/implementWizard.js';
import { closeBrowser, goToStep, openFolded, openUi, shot } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, '').trim());
const storage = (page) => page.getByRole('group', { name: 'How fast do the App\'s pages open?' });

test('What to deliver only picks what gets built, Where it lives places the App on its own step, and the storage choice explains itself', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'What to deliver');
    await page.getByRole('heading', { name: 'How will people use this use case?' }).waitFor();
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot(page, 'what-to-deliver-1280x800', false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, 'what-to-deliver-1440x900', false);
    assert.equal(await page.getByRole('radio', { name: /^One App per use case/ }).count(), 0, 'placement is not on What to deliver (must-exclude)');

    const labels = await stepLabels(page);
    const at = (label) => labels.indexOf(label);
    assert.ok(at('What to deliver') === 0 && at('Where it lives') === at('Measure') + 1 && at('Who uses the App and storage') === at('Where it lives') + 1,
      `What to deliver first, then Where it lives after Measure, then Who uses the App and storage: ${labels.join(' | ')}`);

    await goToStep(page, 'Where it lives');
    await page.getByRole('radio', { name: /^One App per use case/ }).waitFor();
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot(page, 'where-it-lives-1280x800', false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, 'where-it-lives-1440x900', false);

    await goToStep(page, 'What to deliver');
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    assert.deepEqual(await stepLabels(page), labels.filter((l) => !['Where it lives'].includes(l) && !/App/.test(l)),
      'with the App unticked, Where it lives and Page storage are skipped too');
    await page.getByRole('checkbox', { name: /^App / }).check();

    await goToStep(page, 'Who uses the App and storage');
    await page.getByRole('region', { name: 'App access' }).waitFor();
    assert.equal(await storage(page).count(), 0, 'the storage choice stays folded under its Change line until opened (must-exclude)');
    await openFolded(page, 'Page storage');
    const group = storage(page);
    await group.getByRole('status').waitFor({ state: 'detached' });
    await group.getByText('Fast pages (Lakebase)', { exact: true }).waitFor();
    await group.getByText('Delta', { exact: true }).waitFor();
    await group.getByText(PER_USER_GUIDE, { exact: true }).waitFor();
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot(page, 'storage-choice-1280x800', false);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
