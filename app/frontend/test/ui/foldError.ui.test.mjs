import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openFolded, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const STATE = { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } };

test('a Data & results error opens only the block that holds it: the result table is open, Source tables and Table filters stay one line each, and the message is visible', async () => {
  const ui = await openUi('wizard', { ...STATE, forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
    statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }] }) } });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    await openFolded(page, 'Result table');
    await page.getByRole('region', { name: 'Where the result table lives' }).getByLabel('Table name').fill('bad name!');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('can only use catalog, schema and table names', { exact: false }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0, 'Source tables stays one line while the error sits in the result table');
    assert.equal(await page.getByRole('region', { name: 'Table filters' }).count(), 0, 'Table filters stays one line while the error sits in the result table');
    assert.ok(await page.locator('[data-fold-line="Source tables"]').count(), 'Source tables keeps its line with its count');
    assert.ok(await page.locator('[data-fold-line="Table filters"]').count(), 'Table filters keeps its line with its count');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
