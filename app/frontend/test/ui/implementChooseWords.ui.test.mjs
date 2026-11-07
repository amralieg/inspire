import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, onStep, openUi } from './uiSupport.mjs';
import { built } from './implementFixtures.js';

const ME = { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' };

test.after(closeBrowser);

test('the Choose step says in plain words what each choice does to an MVP that already exists', async () => {
  const ui = await openUi('wizard', { me: ME, history: [built()] });
  const { page, pageErrors } = ui;
  try {
    await onStep(page, 'Choose');
    const note = page.locator('[data-editing-note]');
    await note.waitFor({ timeout: 15000 });
    const said = (await note.innerText()).trim();
    assert.equal(said, 'This use case already has an MVP (version 1). Pick “Inspire builds the MVP” to update that MVP, or “I will build it myself” to leave it unchanged.');
    assert.doesNotMatch(said, /\(v\d|edits it;|leaves it as it is/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case with no MVP yet shows no note about an existing one (must-exclude)', async () => {
  const ui = await openUi('wizard', { me: ME });
  const { page, pageErrors } = ui;
  try {
    await onStep(page, 'Choose');
    assert.equal(await page.locator('[data-editing-note]').count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});
