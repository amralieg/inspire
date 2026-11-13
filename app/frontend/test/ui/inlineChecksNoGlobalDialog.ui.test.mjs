import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const STATE = { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } };

// A check that shows its own refusal inline must not also open the full-page Permission Required dialog over the page.
const FOLDER = '/Workspace/Users/pat.lee@example.com/inspire_output';
const folder = {
  statements: [], principal: 'inspire-sp', why: `The run writes its files to ${FOLDER}, and the App cannot write there yet.`,
  instructions: [`In Workspace, open ${FOLDER} > Share, add inspire-sp with Can Edit`],
};

test('an inline output check refusal shows See the grant and does not open the global dialog on its own', async () => {
  const ui = await openUi('launch', STATE_WITH_REFUSAL(folder));
  const { page } = ui;
  try {
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('[data-output-check="refused"] [data-see-grant=""]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-permission-dialog]').count(), 0, 'no full-page dialog opens for an inline check');
    // The browser logs the refused check's 403 as a resource error; that is the check's own refusal, not an app error.
    assert.deepEqual(ui.pageErrors.filter((e) => !/403|Forbidden/.test(e)), []);
  } finally {
    await ui.close();
  }
});

function STATE_WITH_REFUSAL(permission) {
  return { ...STATE, outputRefusal: { message: `Inspire cannot save to ${FOLDER}.`, permissions: [permission] } };
}
