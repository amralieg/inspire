import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { START_DRAFT_PREFIX } from '../../src/lib/wizardDraft.js';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders'] },
  columnsByTable: { 'main.s.orders': [{ column_name: 'brand_name', data_type: 'STRING', ordinal_position: 1 }] },
};

const DOC_OPTIONS = ['PDF Catalog', 'Presentation', 'Excel'];
const offered = (page, name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).count();
const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.locator('[data-launch-run-unsaved]').click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};
async function fillForm(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await idle(page);
}
async function reloaded(page) {
  await page.reload();
  await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await idle(page);
}

test('a new Launch page has no PDF, Presentation or Excel option and the run carries no 09 key (REQ-503 FX-116)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await fillForm(page);
    for (const name of DOC_OPTIONS) assert.equal(await offered(page, name), 0, `${name} is still offered`);
    const params = await launchOf(page, made);
    assert.equal(Object.hasOwn(params, '09_generation_options'), false, 'the job gets no generation option');
  } finally {
    await ui.close();
  }
});

test('a draft saved before FX-116 with document ticks restores no option after a reload, and the run still carries no 09 key', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await fillForm(page);
    await page.evaluate((prefix) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith(prefix));
      const saved = JSON.parse(localStorage.getItem(key));
      saved.spec.genChecks = { 'PDF Catalog': true, Presentation: true, Excel: true };
      localStorage.setItem(key, JSON.stringify(saved));
    }, START_DRAFT_PREFIX);
    await reloaded(page);
    for (const name of DOC_OPTIONS) assert.equal(await offered(page, name), 0, `${name} came back from the old draft`);
    const params = await launchOf(page, made);
    assert.equal(Object.hasOwn(params, '09_generation_options'), false, 'an old draft does not bring the option back');
  } finally {
    await ui.close();
  }
});
