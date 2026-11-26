// REQ-125 (Amr P051): no "Open to List Tables" on the Data steps, no leftover tree/grid split there, and the one resizable split
// (use case list beside the use case) moves with the keyboard and the mouse. The tree and per-table grid left with the REQ-363 redesign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, idle, openUi, steadyBox } from './uiSupport.mjs';

test.after(closeBrowser);

const OPEN_TO_LIST = /open to list( tables)?/i;
const ORDERS = 'main.s.orders';
const STATE = {
  catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] },
  columnsByTable: { [ORDERS]: [{ column_name: 'brand_name', data_type: 'STRING', ordinal_position: 1 }] },
};
const COLUMNS = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }];
const bodyText = (page) => page.evaluate(() => document.body.innerText);

test('the Launch Data Management scope has no "Open to List Tables" and no resizable split', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-hit="brand_name"]').first().waitFor({ timeout: 15000 });
    assert.doesNotMatch(await bodyText(page), OPEN_TO_LIST);
    assert.equal(await page.getByRole('separator').count(), 0, 'no two-part split is left on the Data scope');
    assert.equal(await page.getByRole('tree').count(), 0, 'the tree is gone');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the wizard Data step has no "Open to List Tables" and no resizable split', async () => {
  const ui = await openUi('wizard&discovery=Deep', { columns: COLUMNS, me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    const change = page.getByRole('button', { name: 'Change Table filters', exact: true });
    if (await change.count()) await change.click();
    await page.locator('[data-source-table]').first().waitFor();
    assert.doesNotMatch(await bodyText(page), OPEN_TO_LIST);
    assert.equal(await page.getByRole('separator').count(), 0, 'no two-part split on the Data step');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the use case list split resizes with the arrow keys and with a drag', async () => {
  const ui = await openUi('implement', { useCase: HARNESS_USE_CASE });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const rail = page.locator('[data-implement-rail]');
    const handle = page.getByRole('separator', { name: 'Resize the use case list' });
    await handle.waitFor();
    const width = async () => Math.round((await rail.boundingBox()).width);
    const start = await width();
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    const keyed = await width();
    assert.ok(keyed > start, `the arrow key widens the list (${start} -> ${keyed})`);
    const grip = await steadyBox(handle);
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 40);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 40, grip.y + 40, { steps: 4 });
    await page.mouse.up();
    assert.ok((await width()) < keyed, 'dragging left narrows the list');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
