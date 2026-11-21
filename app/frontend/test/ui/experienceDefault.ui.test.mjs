import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openFolded, openUi, profileAt } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-391: a new build pre-selects Classic UI, and the Agentic choice no longer says (default).
const SHOTS = '/private/tmp/inspire_v15/shots/u11';
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const withData = { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } };
const WITH_PROFILE = { init: profileAt([], GROUPING_PROFILE) };

test('REQ-391: a new build pre-selects Classic UI in How people start in the App, and only Classic UI says (default)', async () => {
  const ui = await openUi('wizard', withData, '', WITH_PROFILE);
  const { page } = ui;
  try {
    await goToStep(page, 'Who uses the App');
    // REQ-418: the who-sees-which-rows fold is not in the default flow any more, so the experience fold is opened by name, not by counting Next.
    await openFolded(page, 'How people start in the App');
    const group = page.locator('[data-choice="app-experience"]');
    await group.getByText('How people start in the App', { exact: true }).waitFor();
    const checked = await group.locator('input[type="radio"]:checked').inputValue();
    assert.equal(checked, 'ui', 'a new build starts classic');
    const labels = await group.locator('label > span > span.font-medium').allInnerTexts();
    assert.deepEqual(labels, ['Agentic', 'Classic UI (default)', 'Both'], 'the default is named once, on Classic UI');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      mkdirSync(SHOTS, { recursive: true });
      await group.screenshot({ path: `${SHOTS}/req391-experience-${width}x${height}.png` });
    }
  } finally {
    await page.close();
  }
});
