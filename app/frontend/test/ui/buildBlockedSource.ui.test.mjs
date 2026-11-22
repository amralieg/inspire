// REQ-456/461 (FX-52, W18a D52): Review & build with a source Inspire cannot share shows the exact GRANT for the data owner, Copy and Check again;
// Build stays off until Check again finds the access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, until, BUILD_IT } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const GRANT = 'GRANT MANAGE ON TABLE `main`.`s`.`orders` TO `inspire-sp`';
const READS = { tables: [{ table: 'main.s.orders', owner: 'data-eng' }], text: 'Inspire cannot share main.s.orders (owned by data-eng) with the App this build makes', blocking: true, grant: [GRANT] };

test('Build is off with the GRANT, Copy and Check again; Check again with the access granted turns Build on', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  let granted = false;
  try {
    await ui.page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => null);
    await page.route('**/api/inspire/implement/plan**', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      const summary = { ...json.summary };
      if (granted) delete summary.app_reads; else summary.app_reads = READS;
      await route.fulfill({ response, json: { ...json, summary } });
    });
    await goToStep(page, 'Review & build');
    const block = page.locator('[data-app-reads-blocking]');
    await block.waitFor({ timeout: 20000 });
    assert.ok((await block.innerText()).includes(GRANT), 'the exact GRANT is on the page');
    await block.getByRole('button', { name: 'Copy', exact: true }).waitFor();
    const build = page.getByRole('button', { name: BUILD_IT, exact: true });
    assert.equal(await build.isDisabled(), true);
    granted = true;
    await block.getByRole('button', { name: 'Check again', exact: true }).click();
    await block.waitFor({ state: 'detached', timeout: 20000 });
    await until(async () => !(await build.isDisabled()), 'Build turns on');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
