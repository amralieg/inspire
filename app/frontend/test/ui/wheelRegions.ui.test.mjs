import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULTS } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { wheelEveryRegion } from './wheelScroll.mjs';

test.after(closeBrowser);

const body = (page) => page.locator('body');

test('every Results scroll region, with the Genie notebook list open when the run has notebooks, takes the mouse wheel to their last item at 1280x800 and 1024x700', async () => {
  const ui = await openUi('results', { results: RESULTS, useCases: [] });
  const { page } = ui;
  try {
    await page.getByRole('region', { name: 'Use case list' }).waitFor({ timeout: 20000 });
    const toggle = page.locator('#genie-quick-access-toggle');
    if (await toggle.count()) await toggle.click();
    const names = await wheelEveryRegion(page, body(page), 'Results', { min: 1, copies: 12 });
    assert.ok(names.length >= 1, JSON.stringify(names));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
