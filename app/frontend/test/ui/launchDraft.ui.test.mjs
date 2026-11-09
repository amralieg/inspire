import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { DRAFT_BACK_NOTE, START_DRAFT_PREFIX, WIZARD_DRAFT_PREFIX } from '../../src/lib/wizardDraft.js';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = {
  catalogs: ['main', 'samples'],
  schemas: { main: ['s', 'x'], samples: ['bakehouse'] },
  tables: { 'main.s': ['orders', 'customers'], 'main.x': ['stock'], 'samples.bakehouse': ['sales'] },
};
const note = (page) => page.locator('[data-launch-draft]');
const drafts = (page) => page.evaluate(([start, wizard]) => Object.keys(localStorage).filter((k) => k.startsWith(start) || k.startsWith(wizard)), [START_DRAFT_PREFIX, WIZARD_DRAFT_PREFIX]);
const pickedLine = (page) => page.getByText('Selected Metadata', { exact: true }).locator('xpath=..');

async function fillForm(page) {
  await page.getByPlaceholder(BUSINESS).fill('Draft Corp');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await until(async () => (await drafts(page)).length === 1, 'the draft is saved');
}

async function reloaded(page) {
  await page.reload();
  await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
  await idle(page);
}

test('a reload on a filled Start form brings the picks back with a note, and Start over empties the form and the draft (must-exclude)', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await reloaded(page);
    assert.equal(await note(page).count(), 0, 'a form nobody filled keeps no draft and shows no note');
    assert.deepEqual(await drafts(page), []);

    await fillForm(page);
    const keys = await drafts(page);
    assert.ok(keys[0].startsWith(START_DRAFT_PREFIX), 'the Start form uses the Start draft key, never a wizard key');
    await reloaded(page);
    assert.equal((await note(page).innerText()).includes(DRAFT_BACK_NOTE), true);
    assert.equal(await page.getByPlaceholder(BUSINESS).inputValue(), 'Draft Corp');
    await until(async () => /1 table/.test(await pickedLine(page).innerText()), 'the picked table is back');

    await page.locator('[data-launch-start-over]').click();
    await idle(page);
    assert.equal(await note(page).count(), 0);
    assert.equal(await page.getByPlaceholder(BUSINESS).inputValue(), '');
    assert.equal(await page.getByText('Selected Metadata', { exact: true }).count(), 0, 'no metadata stays picked');
    assert.deepEqual(await drafts(page), []);
    await reloaded(page);
    assert.equal(await note(page).count(), 0, 'after Start over a reload brings nothing back');
    assert.equal(await page.getByPlaceholder(BUSINESS).inputValue(), '');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of (403|404)/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('starting the run clears the Start draft, so the next visit opens an empty form', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await fillForm(page);
    await reloaded(page);
    assert.equal(await note(page).count(), 1);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['00_business_name'], 'Draft Corp', 'the restored picks are the ones launched');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.orders');
    await until(async () => (await drafts(page)).length === 0, 'the draft is gone after the launch');
    await reloaded(page);
    assert.equal(await note(page).count(), 0);
    assert.equal(await page.getByPlaceholder(BUSINESS).inputValue(), '');
  } finally {
    await ui.close();
  }
});
