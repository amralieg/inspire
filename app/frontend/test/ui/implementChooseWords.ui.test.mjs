import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onStep, openUi } from './uiSupport.mjs';
import { built } from './implementFixtures.js';

const ME = { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' };

test.after(closeBrowser);

test('a use case with no MVP yet shows no note about an existing one (must-exclude)', async () => {
  let loaded;
  const ui = await openUi('wizard', { me: ME }, '', {
    init: async (page) => { loaded = page.waitForResponse((r) => r.url().includes('/api/inspire/implement/context?'), { timeout: 15000 }); },
  });
  const { page, pageErrors } = ui;
  try {
    const context = await loaded;
    assert.equal(context.status(), 200);
    assert.equal((await context.json()).latest ?? null, null, 'the use case has no MVP yet');
    await goToStep(page, 'Data');
    assert.equal(await page.locator('input[name="implement-mode"]').count(), 0, 'no MVP or notebook choice (must-exclude)');
    assert.equal(await page.locator('[data-editing-note]').count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});
