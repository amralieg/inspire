import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openRow, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const STATE = { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } };
const RESULTS = 'Where the result table lives';

test('Data & results folds one block at a time: opening the result table folds Source tables and Table filters to a line each with their count, and opening either of them folds the result table', async () => {
  const ui = await openUi('wizard', STATE);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await page.getByRole('region', { name: RESULTS }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0, 'the result table is open on arrival, so Source tables is a line');
    await page.getByText(/^Source tables: 1 table: /).waitFor();
    await page.getByText(/^Table filters: \d+ filters? on 1 table$/).waitFor();
    await page.getByRole('button', { name: 'Change Source tables', exact: true }).click();
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    assert.equal(await page.getByRole('region', { name: RESULTS }).count(), 0, 'opening Source tables folds the result table');
    assert.equal(await page.getByRole('region', { name: 'Table filters' }).count(), 0, 'Table filters stays a line while Source tables is open');
    await page.getByRole('button', { name: 'Change Table filters', exact: true }).click();
    await page.getByRole('region', { name: 'Table filters' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0, 'opening Table filters folds Source tables');
    assert.equal(await page.getByRole('region', { name: RESULTS }).count(), 0, 'opening Table filters folds the result table');
    await openRow(page, 'result table');
    await page.getByRole('region', { name: RESULTS }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Table filters' }).count(), 0, 'opening the result table folds Table filters');
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0, 'opening the result table folds Source tables');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
