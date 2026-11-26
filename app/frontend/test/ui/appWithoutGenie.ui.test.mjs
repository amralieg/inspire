import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' };

test('REQ-514: the Build wizard has no Genie Agent or App choice to untick: the App with its Genie is always built', async () => {
  const ui = await openUi('wizard', { me: ME });
  const { page, pageErrors } = ui;
  try {
    await goToStep(page, 'Data');
    await goToStep(page, 'What to deliver');
    await page.getByRole('checkbox', { name: /^Dashboard/ }).first().waitFor();
    assert.equal(await page.getByRole('checkbox', { name: /^Genie Agent/ }).count(), 0, 'REQ-514: the Genie Agent is not a choice');
    assert.equal(await page.getByRole('checkbox', { name: /^App/ }).count(), 0, 'REQ-514: the App is not a choice');
    assert.equal(await page.getByText('needs a Genie Agent', { exact: false }).count(), 0, 'no stale note says the App needs a Genie Agent');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});
