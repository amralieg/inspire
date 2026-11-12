import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, onStep, openUi } from './uiSupport.mjs';
import { WIZARD_DRAFT_PREFIX } from '../../src/lib/wizardDraft.js';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const COLUMNS = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'status', data_type: 'STRING', ordinal_position: 2 }];
const VALUES = { status: ['gold', 'silver'] };
const block = (page, table) => page.locator(`[data-source-table="${table}"]`);
const draftFilters = (page) => page.evaluate((prefix) => {
  const key = Object.keys(localStorage).find((k) => k.startsWith(prefix));
  return key ? JSON.parse(localStorage.getItem(key)).spec.data.filters.map((f) => f.table) : null;
}, WIZARD_DRAFT_PREFIX);

test('a button that changes the spec saves the draft: removing a filter left on a table that is no longer a source is kept after a reload', async () => {
  const ui = await openUi('wizard&discovery=Deep', { columns: COLUMNS, valuesByColumn: VALUES, me: ME, useCase: HARNESS_USE_CASE });
  const { page, pageErrors } = ui;
  try {
    await goToStep(page, 'Data');
    const changeFilters = page.getByRole('button', { name: 'Change Table filters', exact: true });
    if (await changeFilters.count()) await changeFilters.click();
    await block(page, 'main.s.orders').getByLabel('Filter rows of main.s.orders by column').selectOption('status');
    await block(page, 'main.s.orders').getByRole('button', { name: 'Load values' }).first().click();
    await block(page, 'main.s.orders').getByRole('checkbox', { name: 'gold', exact: true }).first().check();
    await page.waitForFunction((prefix) => Object.keys(localStorage).some((k) => k.startsWith(prefix)), WIZARD_DRAFT_PREFIX);
    await page.evaluate((prefix) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith(prefix));
      const draft = JSON.parse(localStorage.getItem(key));
      draft.spec.data.filters.push({ table: 'main.s.gone', column: 'status', op: 'in', values: ['x'] });
      localStorage.setItem(key, JSON.stringify(draft));
    }, WIZARD_DRAFT_PREFIX);
    await page.reload();
    await onStep(page, 'Data');
    const changeAfter = page.getByRole('button', { name: 'Change Table filters', exact: true });
    if (await changeAfter.count()) await changeAfter.click();
    const orphan = page.locator('[data-filters-outside="main.s.gone"]');
    await orphan.waitFor();
    assert.ok((await draftFilters(page)).includes('main.s.gone'), 'the seeded draft holds the orphan filter');
    await orphan.getByRole('button', { name: 'Remove these filters', exact: true }).click();
    await orphan.waitFor({ state: 'detached' });
    assert.deepEqual(await draftFilters(page), ['main.s.orders'], 'the button-only removal rewrote the draft without the orphan');
    await page.reload();
    await onStep(page, 'Data');
    await block(page, 'main.s.orders').waitFor();
    assert.equal(await page.locator('[data-filters-outside]').count(), 0, 'the reload restores the saved draft without the orphan');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});
