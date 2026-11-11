import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOneBadgeOnDefault, choicesShown, closeBrowser, goToStep, onStep, openUi, settleChoices } from './uiSupport.mjs';
import { APP_LOOK_STEP, APP_LOOK_TABS, APP_STEP, WHERE_LABEL } from '../../src/lib/implementWizard.js';

const OWNER = ['owner', 'example.com'].join('@');
const DATED = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];

test.after(closeBrowser);

async function auditEveryStep(page, { look = true } = {}) {
  const seen = new Set();
  const labels = (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\.\s*/, '').trim());
  for (const label of labels) {
    await goToStep(page, label);
    if (label === APP_STEP.label) await page.getByText('Finding the Apps Inspire built').waitFor({ state: 'detached' });
    await settleChoices(page);
    const tabs = label === APP_LOOK_STEP.label && look ? APP_LOOK_TABS.map((t) => t.label) : [null];
    for (const tab of tabs) {
      if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
      const shown = await choicesShown(page);
      const where = tab ? `${label} / ${tab}` : label;
      assertOneBadgeOnDefault(shown, where, { perChoice: true });
      assertOneBadgeOnDefault(shown.filter((c) => c.choice === 'outputs' || c.choice.startsWith('removed-')), `${where} outputs`);
      if (label === WHERE_LABEL) assertOneBadgeOnDefault(shown.filter((c) => ['app-place', 'app-target'].includes(c.choice)), `${where} placement`);
      if (label === WHERE_LABEL) assertOneBadgeOnDefault(shown.filter((c) => ['app-options', 'replace-edits'].includes(c.choice)), `${where} features`);
      for (const { choice } of shown) seen.add(choice);
    }
  }
  return seen;
}

test('every choice in the wizard shows exactly one Recommended badge, and it sits on the option the wizard starts on', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
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
    await page.locator('[data-choice="freshness"] [data-recommended="daily"]').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
