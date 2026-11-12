import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const built = () => {
  const made = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
    updated_at: '2026-11-09T02:52:41Z', created_at: '2026-11-09T01:57:09Z', spec_json: JSON.stringify(made), job_id: '77',
    notebook_path: '/W/inspire/N01-U01', asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 1 } }), status_message: '' }];
};

test('the Build progress drawer that opens by itself on a built use case does not take focus or scroll the page; a click to open it moves focus into it', async () => {
  const ui = await openUi('implement', { history: built(), me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  const focusInPanel = () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-progress-panel]')));
  try {
    await page.locator('[data-progress-panel]').first().waitFor({ timeout: 15000 });
    assert.equal(await focusInPanel(), false, 'a drawer that opens by default never takes keyboard focus');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'opening by default never scrolls the page');
    await page.locator('[data-progress-show]').first().click();
    await page.locator('[data-progress-panel]').first().waitFor({ state: 'detached', timeout: 15000 });
    await page.locator('[data-progress-show]').first().click();
    await page.locator('[data-progress-panel]').first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => Boolean(document.activeElement?.closest('[data-progress-panel]')), null, { timeout: 5000 });
    assert.equal(await focusInPanel(), true, 'a click to open the drawer moves focus into it');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
