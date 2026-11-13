// REQ-155 (L4): the Results card title reads the stored name. A stale generated label (name_with_technique) that holds the
// name twice must not show as a doubled title, even when the use case has no user name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const CLEAN = 'Predict churn';
const DOUBLED = `${CLEAN} ${CLEAN}`;
const cardOf = (page) => page.locator('[data-use-case-no="N01-U01"]');

function staleLabelRoute() {
  return async (page) => {
    await page.route(/\/api\/inspire\/usecases\?/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const rows = (body.usecases || []).filter((row) => String(row.id) !== 'N01-U01');
      rows.push({ id: 'N01-U01', session_id: 42, use_case: CLEAN, Name: CLEAN, original_name: CLEAN, name_with_technique: DOUBLED, user_use_case_name: null });
      await route.fulfill({ response, json: { ...body, usecases: rows } });
    });
  };
}

test('the card title is the stored name, not a stale generated label that repeats it (must-exclude: no doubled title)', async () => {
  const ui = await openUi('results', REVIEW_STATE, '', { init: staleLabelRoute() });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cardOf(page).locator('[aria-expanded]').first().waitFor();
    await idle(page);
    const title = (await cardOf(page).locator('h3').innerText()).trim();
    assert.notEqual(title, DOUBLED, 'the card must not show the generated label');
    assert.equal(title, CLEAN, 'the card shows the stored name');
  } finally {
    await ui.close();
  }
});
