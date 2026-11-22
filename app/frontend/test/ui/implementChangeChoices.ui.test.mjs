// REQ-273: a failed MVP card offers a way back into the wizard with the last choices, without uninstalling.
// A published, working MVP keeps its card (must-keep).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

const CHANGE = 'Change choices and build again';

test.after(closeBrowser);

test('REQ-273: an MVP whose publish failed offers Change choices and build again on its card, beside Uninstall this use case, and opens the wizard', async () => {
  const failed = built({ spec_version: 2, status: 'failed', status_message: 'App not published: Inspire tried 2 times and could not build it' });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed, built()] });
  const { page } = ui;
  try {
    const change = page.getByRole('button', { name: CHANGE, exact: true });
    await change.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Uninstall this use case', exact: true }).count(), 1, 'Uninstall this use case stays for a built MVP');
    await change.click();
    await page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ }).waitFor({ timeout: 15000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('REQ-273 must-keep: a published, working MVP keeps its card with no Change choices button', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Uninstall this use case', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: CHANGE, exact: true }).count(), 0, 'a published MVP has no second route into the wizard');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
