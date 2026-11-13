import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openFolded, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const STATE = { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } };
const RESULTS = 'Where the result table lives';

test('Data & results folds one block at a time: opening the result table folds Source tables and Table filters to a line each with their count, and opening either of them folds the result table', async () => {
  const ui = await openUi('wizard', STATE);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    // The first section of Data & results is open on arrival; the Result table is opened by its title.
    await page.getByRole('heading', { name: 'Source tables' }).or(page.locator('[data-fold-line="Source tables"]')).first().waitFor();
    await openFolded(page, 'Result table');
    await page.getByRole('region', { name: RESULTS }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0, 'opening the result table folds Source tables to a line');
    const sourcesLine = page.locator('[data-fold-line="Source tables"]');
    const sourcesText = (await sourcesLine.innerText()).trim();
    const sourcesMatch = /^Source tables: (\d+) tables?: (.+)$/.exec(sourcesText);
    assert.ok(sourcesMatch, `the folded Source tables line counts and names its tables: "${sourcesText}"`);
    assert.equal(Number(sourcesMatch[1]), sourcesMatch[2].split(', ').length, `the count matches the names: "${sourcesText}"`);
    assert.ok(sourcesMatch[2].includes('main.s.orders'), `the table is named: "${sourcesText}"`);
    assert.match((await page.locator('[data-fold-line="Table filters"]').innerText()).trim(), /^Table filters: \d+ filters? on \d+ tables?$/, 'the folded Table filters line counts its filters');
    await page.getByRole('button', { name: 'Change Source tables', exact: true }).click();
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    assert.equal(await page.getByRole('region', { name: RESULTS }).count(), 0, 'opening Source tables folds the result table');
    assert.equal(await page.getByRole('region', { name: 'Table filters' }).count(), 0, 'Table filters stays a line while Source tables is open');
    await page.getByRole('button', { name: 'Change Table filters', exact: true }).click();
    await page.getByRole('region', { name: 'Table filters' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0, 'opening Table filters folds Source tables');
    assert.equal(await page.getByRole('region', { name: RESULTS }).count(), 0, 'opening Table filters folds the result table');
    await openFolded(page, 'Result table');
    await page.getByRole('region', { name: RESULTS }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Table filters' }).count(), 0, 'opening the result table folds Table filters');
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0, 'opening the result table folds Source tables');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
