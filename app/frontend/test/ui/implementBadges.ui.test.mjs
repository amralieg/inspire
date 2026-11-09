import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOneBadgeOnDefault, choicesShown, closeBrowser, goToStep, onStep, openUi, settleChoices } from './uiSupport.mjs';
import { APP_LOOK_TABS } from '../../src/lib/implementWizard.js';

const OWNER = ['owner', 'example.com'].join('@');
const DATED = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];

test.after(closeBrowser);

async function auditEveryStep(page, { look = true } = {}) {
  const seen = new Set();
  const labels = (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\.\s*/, '').trim());
  for (const label of labels) {
    await goToStep(page, label);
    if (label === 'App') await page.getByText('Finding the Apps Inspire built').waitFor({ state: 'detached' });
    await settleChoices(page);
    const tabs = label === 'App' && look ? APP_LOOK_TABS.map((t) => t.label) : [null];
    for (const tab of tabs) {
      if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
      const shown = await choicesShown(page);
      assertOneBadgeOnDefault(shown, tab ? `${label} / ${tab}` : label);
      for (const { choice } of shown) seen.add(choice);
    }
  }
  return seen;
}

test('every choice in the wizard shows exactly one Highly Recommended badge, and it sits on the option the wizard starts on', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    await onStep(page, 'Data');
    const seen = await auditEveryStep(page);
    assert.equal(seen.has('mode'), false, 'no MVP or notebook choice (must-exclude)');
    for (const choice of ['outputs', 'first-run', 'result-table', 'kpi', 'holdout', 'freshness', 'app-place', 'app-policy',
      'app-access', 'app-backend', 'app-options', 'app-style', 'app-palette', 'app-theme', 'app-layout']) {
      assert.ok(seen.has(choice), `the walk reached ${choice}: ${[...seen].join(', ')}`);
    }
    assert.equal(seen.has('merge-genie_space'), false, 'with nothing built there is no existing Genie Agent to add to (must-exclude)');
    await goToStep(page, 'What to build');
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await goToStep(page, 'Keep it fresh');
    const fresh = page.getByRole('group', { name: 'Keep it fresh' });
    assert.equal(await fresh.getByRole('button', { name: 'Daily' }).getAttribute('aria-pressed'), 'true', 'Keep it fresh starts on Daily, where the badge is');
    assertOneBadgeOnDefault((await choicesShown(page)).filter((c) => c.choice === 'freshness'), 'Keep it fresh with an alert');
    await page.locator('[data-choice="freshness"] [data-highly-recommended="daily"]').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
