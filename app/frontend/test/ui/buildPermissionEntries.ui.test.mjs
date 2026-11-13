import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-150: the scope-view grant the App could not get reaches the Build page as one Permission Required entry with its exact statement.
const STATEMENT = 'GRANT SELECT ON TABLE `main`.`inspire`.`churn_scope` TO `app-sp-2`';
const PERMISSION = {
  statements: [STATEMENT], instructions: [], principal: 'app-sp-2',
  why: 'The App cannot read its Data Filters view yet, so the filters show nothing. Ask your workspace admin to run these commands, then click Try again.',
};

function buildWithPermission() {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.permissions = [PERMISSION];
  return { ...row, asset_status: JSON.stringify(assets) };
}

test('the Build page opens Permission Required once for the build entry, with its exact statement and no duplicate dialog', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [buildWithPermission()] });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    // The entry opens Permission Required on load, over the drawer, so read it before the build is expanded.
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-permission-dialog]').count(), 1, 'one dialog, not one per poll');
    assert.match(await dialog.locator('#permission-required-title').innerText(), /^Permission Required$/);
    const statements = (await dialog.locator('[data-permission-statements=""]').innerText()).split('\n').map((s) => s.replace(/;$/, ''));
    assert.deepEqual(statements, [STATEMENT], 'the statement the person copies for the admin');
    await dialog.getByRole('button', { name: 'Close' }).click();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
