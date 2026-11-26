import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICIED_SOURCE, closeBrowser, goToStep, openFolded, openUi, shot } from './uiSupport.mjs';
import { APP_STORAGE_LABEL } from '../../src/lib/implementWizard.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, '').trim());
const storage = (page) => page.getByRole('region', { name: APP_STORAGE_LABEL });

test('What to deliver only picks what gets built, Where it lives places the App on its own step, and the storage step offers no choice', async () => {
  const ui = await openUi('wizard', { ...ME, policies: POLICIED_SOURCE });
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
    assert.ok(at('How to build') === 0 && at('What to deliver') === 1 && at('Where it lives') === at('First run') + 1 && labels.filter((l) => l === 'Where it lives').length === 1 && !labels.includes('Who uses the App and storage') && !labels.includes('App look'),
      `How to build first (REQ-457a), then What to deliver, then Where it lives after First run (the Measure step left the wizard, REQ-453), which holds every App panel (REQ-002): ${labels.join(' | ')}`);

    await goToStep(page, 'Where it lives');
    await page.getByRole('radio', { name: /^One App per use case/ }).waitFor();
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot(page, 'where-it-lives-1280x800', false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, 'where-it-lives-1440x900', false);

    await goToStep(page, 'What to deliver');
    // REQ-514: the App is always built; there is no App checkbox and the App steps stay.
    assert.equal(await page.getByRole('checkbox', { name: /^App / }).count(), 0, 'the App is not an option');
    assert.deepEqual(await stepLabels(page), labels, 'Where it lives and SQL warehouse for the App stay');

    await goToStep(page, 'Where it lives');
    await openFolded(page, 'Who sees which rows');
    // REQ-418: the access choice shows for a policied source; the per-user guide is about the per-user choice, so that is picked here.
    await page.getByRole('region', { name: 'App access' }).getByRole('radio', { name: /^Sensitive data/ }).check();
    assert.equal(await storage(page).count(), 0, 'the storage choice stays folded under its Change line until opened (must-exclude)');
    await openFolded(page, APP_STORAGE_LABEL);
    const group = storage(page);
    await group.getByRole('status').waitFor({ state: 'detached' });
    assert.equal(await group.getByRole('radio').count(), 0, 'Inspire decides Lakebase or Delta; the step offers no choice (REQ-528)');
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot(page, 'storage-choice-1280x800', false);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
