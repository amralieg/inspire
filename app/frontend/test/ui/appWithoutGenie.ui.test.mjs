import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' };

test('the Build wizard lets a person build the App without a Genie Agent: the Genie Agent is not locked while the App is on, unticks, and the App stays on', async () => {
  const ui = await openUi('wizard', { me: ME });
  const { page, pageErrors } = ui;
  try {
    await goToStep(page, 'Data');
    await goToStep(page, 'What to deliver');
    const genie = page.getByRole('checkbox', { name: /^Genie Agent/ }).first();
    const app = page.getByRole('checkbox', { name: /^App/ }).first();
    await genie.waitFor();
    assert.equal(await app.isChecked(), true, 'the App is on by default');
    assert.equal(await genie.isChecked(), true, 'the Genie Agent is ticked by default');
    assert.equal(await genie.isDisabled(), false, 'the Genie Agent is not locked while the App is on');
    await genie.uncheck();
    assert.equal(await genie.isChecked(), false, 'the Genie Agent unticks');
    assert.equal(await app.isChecked(), true, 'the App stays on');
    assert.equal(await page.getByText('needs a Genie Agent', { exact: false }).count(), 0, 'no stale note says the App needs a Genie Agent');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});
