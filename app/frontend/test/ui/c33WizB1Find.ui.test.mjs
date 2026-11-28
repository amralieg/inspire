// c33 lane B acceptance (REQ-577 5a): "Find suitable data for me" picks catalogs only, says no data rows are read, and is ready once a catalog
// is picked. Rendered alone through the harness (open=wizStep&step=find). Written by the c33 planner; the lane B builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { NO_DATA_ROWS_NOTE } from '../../src/lib/startWizard.js';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const draftOf = async (page) => JSON.parse(await page.locator('output[aria-label="Wizard draft"]').innerText());
const ready = (page) => page.locator('output[aria-label="Step ready"]').innerText();
const withDraft = (draft) => ({ init: (page) => page.addInitScript((d) => { window.__WIZ_DRAFT__ = d; }, draft) });
const STATE = { catalogs: ['main', 'sales_prod', 'dev_sandbox'] };

test('REQ-577 5a: the find step lists catalogs as checkboxes, keeps the picked ones in the draft and is ready only with one picked (must-fail on the base)', async () => {
  const ui = await openUi('wizStep', STATE, '&step=find', withDraft({ catalogs: [] }));
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="find"]');
    await step.waitFor({ timeout: 15000 });
    assert.equal(await step.getAttribute('data-wiz-stub'), null, 'the find step is built, not the base stub');
    for (const name of STATE.catalogs) await step.getByRole('checkbox', { name, exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await step.locator('input[type="checkbox"]').count(), 3, 'one checkbox per catalog, nothing at schema or table level');
    assert.equal(await ready(page), 'no', 'not ready with no catalog');
    await step.getByRole('checkbox', { name: 'main', exact: true }).check();
    await step.getByRole('checkbox', { name: 'sales_prod', exact: true }).check();
    await until(async () => (await ready(page)) === 'yes', 'ready with a catalog picked');
    assert.deepEqual((await draftOf(page)).catalogs, ['main', 'sales_prod']);
    await step.getByRole('checkbox', { name: 'main', exact: true }).uncheck();
    await step.getByRole('checkbox', { name: 'sales_prod', exact: true }).uncheck();
    await until(async () => (await ready(page)) === 'no', 'not ready again with none picked');
    assert.ok((await step.innerText()).includes(NO_DATA_ROWS_NOTE), 'the step says no data rows are read');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 5a: catalogs already in the draft come back checked (Back keeps the pick) (must-fail on the base)', async () => {
  const ui = await openUi('wizStep', STATE, '&step=find', withDraft({ catalogs: ['sales_prod'] }));
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="find"]');
    const box = step.getByRole('checkbox', { name: 'sales_prod', exact: true });
    await box.waitFor({ timeout: 15000 });
    assert.equal(await box.isChecked(), true);
    assert.equal(await step.getByRole('checkbox', { name: 'main', exact: true }).isChecked(), false);
    await until(async () => (await ready(page)) === 'yes', 'ready with the kept pick');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
