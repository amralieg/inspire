import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, openUi, sqlStatementsOf } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-150: the scope-view grant the App could not get reaches the Build page as one Permission Required entry with its exact statement.
const STATEMENT = 'GRANT SELECT ON TABLE `main`.`inspire`.`churn_scope` TO `app-sp-2`';
const PERMISSION = {
  statements: [STATEMENT], instructions: [], principal: 'app-sp-2',
  why: 'The App cannot read its Data Filters view yet, so the filters show nothing.',
};

function buildWithPermission() {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.permissions = [PERMISSION];
  return { ...row, asset_status: JSON.stringify(assets) };
}

test('the Build page shows the build entry inline, opens Permission Required only on See the grant, with its exact statement and no duplicate dialog', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [buildWithPermission()] });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    // REQ-406: the entry is an inline note on load; the dialog opens only from its See the grant button.
    const note = page.locator('[data-permission-note]');
    await note.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-permission-dialog]').count(), 0, 'no dialog on load');
    await note.getByRole('button', { name: 'See the grant', exact: true }).click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-permission-dialog]').count(), 1, 'one dialog, not one per poll');
    assert.match(await dialog.locator('#permission-required-title').innerText(), /^Permission Required$/);
    const statements = sqlStatementsOf(await dialog.locator('[data-permission-statements=""]').textContent());
    assert.deepEqual(statements, [STATEMENT], 'the statement the person copies for the admin');
    await dialog.getByRole('button', { name: 'Close' }).click();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
