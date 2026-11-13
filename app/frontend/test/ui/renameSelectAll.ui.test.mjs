import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const TYPED = 'Churn early warning';
const cardOf = (page) => page.locator('[data-use-case-no="N01-U01"]');

function routes(posted) {
  let renamed = '';
  return async (page) => {
    await page.route('**/api/inspire/usecase-name', async (route) => {
      posted.rename.push(JSON.parse(route.request().postData() || '{}'));
      renamed = posted.rename.at(-1).name;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, name: renamed }) });
    });
    await page.route(/\/api\/inspire\/usecases\?/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const stored = (body.usecases || []).filter((row) => String(row.id) !== 'N01-U01');
      if (renamed) stored.push({ id: 'N01-U01', session_id: 42, use_case: 'Predict churn', Name: renamed, original_name: 'Predict churn', user_use_case_name: renamed });
      await route.fulfill({ response, json: { ...body, usecases: renamed ? stored : (body.usecases || []) } });
    });
  };
}

test('REQ-144 opening the rename field selects the whole current name, so typing replaces it and the saved and shown name are exactly what was typed (must-exclude: no old text kept)', async () => {
  const posted = { rename: [] };
  const ui = await openUi('results', REVIEW_STATE, '', { init: routes(posted) });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cardOf(page).locator('[aria-expanded]').first().waitFor();
    await idle(page);
    const title = cardOf(page).locator('h3');
    const before = await title.innerText();
    await page.getByRole('button', { name: `Rename ${before}` }).click();
    const field = cardOf(page).getByRole('textbox', { name: `Use case name for ${before}` });
    await field.waitFor();
    const selection = await field.evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length]);
    assert.deepEqual(selection, [0, before.length, before.length], 'the whole current name is selected on open');
    await page.keyboard.type(TYPED);
    await field.press('Enter');
    await page.waitForFunction((t) => document.querySelector('[data-use-case-no="N01-U01"] h3')?.innerText.trim() === t, TYPED, { timeout: 10000 });
    assert.equal(posted.rename.length, 1, 'one save');
    assert.equal(posted.rename[0].name, TYPED, 'the saved name is exactly what was typed');
    assert.equal((await title.innerText()).trim(), TYPED, 'the shown name is exactly what was typed');
  } finally {
    await ui.close();
  }
});
