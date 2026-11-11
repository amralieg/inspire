import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const RENAMED = 'Churn early warning';
const UPDATE = 'Update the live App to show the new name';
const cardOf = (page, no) => page.locator(`[data-use-case-no="${no}"]`);

test('after a rename, the live App offers one Update button; clicking it posts the built spec under the new name and the card reloads its progress (must-exclude)', async () => {
  const posted = { rename: [], submit: [] };
  let renamed = '';
  let historyCalls = 0;
  const init = async (page) => {
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
      const rows = renamed ? stored : (body.usecases || []);
      await route.fulfill({ response, json: { ...body, usecases: rows } });
    });
    await page.route(/\/api\/inspire\/implement\/history\?/, async (route) => {
      historyCalls += 1;
      await route.continue();
    });
    await page.route('**/api/inspire/implement/submit', async (route) => {
      posted.submit.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ use_case_id: 'N01-U01', spec_version: 2 }) });
    });
  };
  const ui = await openUi('results', REVIEW_STATE, '', { init });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cardOf(page, 'N01-U01').locator('[aria-expanded]').first().waitFor();
    await idle(page);
    await cardOf(page, 'N01-U01').locator('[aria-expanded]').first().click();
    const editor = cardOf(page, 'N01-U01').locator('[data-use-case-name-editor]');
    await editor.waitFor();
    assert.equal(await page.getByRole('button', { name: UPDATE }).count(), 0, 'no rename, no update button');

    await editor.locator('input').fill(RENAMED);
    await editor.getByRole('button', { name: 'Save name' }).click();
    await until(async () => posted.rename.length === 1);
    assert.deepEqual(posted.rename[0], { inspire_database: posted.rename[0].inspire_database, warehouse_id: posted.rename[0].warehouse_id, session_id: '42', use_case_id: 'N01-U01', name: RENAMED });

    const update = page.getByRole('button', { name: UPDATE });
    await update.waitFor();
    const historyBefore = historyCalls;
    await update.click();
    await until(async () => posted.submit.length === 1);
    const { spec } = posted.submit[0];
    assert.equal(spec.use_case_name, RENAMED, 'the restyle carries the new name');
    assert.equal(spec.use_case_id, 'N01-U01');
    assert.equal(spec.based_on_version, 1, 'it is based on the built version, the live App');
    assert.equal(spec.outputs.app, true, 'the App output is kept');
    await until(async () => historyCalls > historyBefore);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
