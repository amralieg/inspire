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

const option = (page, name) => page.locator('button[aria-pressed]').filter({ hasText: name });
const pressed = async (page, name) => (await option(page, name).getAttribute('aria-pressed')) === 'true';
const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
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
  await option(page, 'PDF Catalog').waitFor({ timeout: 15000 });
}
async function reloaded(page) {
  await page.reload();
  await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await option(page, 'PDF Catalog').waitFor({ timeout: 15000 });
}

test('the strategy PDF (PDF Catalog) and the Excel workbook are ticked by default and the run carries both; Presentation stays off', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await fillForm(page);
    assert.equal(await pressed(page, 'PDF Catalog'), true, 'the PDF is ticked on a new Launch page');
    assert.equal(await pressed(page, 'Presentation'), false);
    assert.equal(await pressed(page, 'Excel'), true, 'the Excel workbook is ticked on a new Launch page');
    const params = await launchOf(page, made);
    assert.equal(params['09_generation_options'], 'PDF Catalog,Excel', 'the job carries the PDF Catalog and Excel options');
  } finally {
    await ui.close();
  }
});

test('a reload keeps the PDF ticked with the other choices, and a draft saved without the PDF choice restores it ticked', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await fillForm(page);
    await option(page, 'Presentation').click();
    await reloaded(page);
    assert.equal(await pressed(page, 'PDF Catalog'), true, 'the ticked PDF survives a reload');
    assert.equal(await pressed(page, 'Presentation'), true, 'the Presentation the person ticked survives too');

    await page.evaluate((prefix) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith(prefix));
      const saved = JSON.parse(localStorage.getItem(key));
      delete saved.spec.genChecks['PDF Catalog'];
      localStorage.setItem(key, JSON.stringify(saved));
    }, START_DRAFT_PREFIX);
    await reloaded(page);
    assert.equal(await pressed(page, 'PDF Catalog'), true, 'a draft without the PDF choice restores it ticked');
    const params = await launchOf(page, made);
    assert.deepEqual(params['09_generation_options'].split(',').sort(), ['Excel', 'PDF Catalog', 'Presentation']);
  } finally {
    await ui.close();
  }
});

test('unticking the PDF and the Excel workbook launches with the option empty, which the run reads as no documents', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await fillForm(page);
    await option(page, 'PDF Catalog').click();
    await option(page, 'Excel').click();
    assert.equal(await pressed(page, 'PDF Catalog'), false);
    const params = await launchOf(page, made);
    assert.equal(params['09_generation_options'], '', 'the person unticked every document');
  } finally {
    await ui.close();
  }
});
