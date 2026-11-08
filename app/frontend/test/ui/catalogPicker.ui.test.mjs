import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, dataToResults, onStep, openAdvanced, openUi, goToStep, until } from './uiSupport.mjs';

test.after(closeBrowser);

const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const many = Array.from({ length: 80 }, (_, i) => `cat_${String(i).padStart(3, '0')}`);

async function resultStep(state) {
  const ui = await openUi('wizard', { me: { userName: 'owner@example.com', displayName: 'Owner' }, schemas: { main: ['inspire'] }, ...state });
  await onStep(ui.page, 'Delivery consumption');
  await goToStep(ui.page, 'Data');
  await dataToResults(ui.page);
  const step = ui.page.getByRole('region', { name: 'Where the result table lives' });
  await step.getByRole('heading', { name: 'Where should the result table live?' }).waitFor();
  return { ui, step: ui.page.getByRole('group', { name: 'Result table catalog and schema' }) };
}

test('a long catalog list is searched by typing, a cut one says so, and a typed catalog past the cut can be chosen (must-exclude: a short list stays a plain pick)', async () => {
  const { ui, step } = await resultStep({ catalogs: ['main', ...many], catalogsCut: true });
  try {
    const catalog = step.getByLabel('Catalog');
    assert.equal(await catalog.evaluate((el) => el.tagName), 'INPUT');
    assert.equal(await step.locator('datalist option').count(), 81);
    assert.equal((await step.locator('[data-catalog-note]').innerText()).trim(),
      'Inspire listed the first 81 catalogs you can see; type the name of one that is not listed');
    await catalog.fill('zz_beyond');
    assert.equal((await step.locator('[data-catalog-note]').innerText()).trim(),
      'zz_beyond is not among the first 81 catalogs Inspire listed; Inspire checks it with Unity Catalog when it reads its schemas');
    assert.equal(await catalog.inputValue(), 'zz_beyond');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const short = await resultStep({ catalogs: ['main', 'sales'] });
  try {
    const catalog = short.step.getByLabel('Catalog');
    assert.equal(await catalog.evaluate((el) => el.tagName), 'SELECT');
    assert.equal(await short.step.locator('[data-catalog-note]').count(), 0);
  } finally {
    await short.ui.close();
  }
});

test('Results makes a new schema or catalog for the result table with the right named, and a refused create says why and keeps the choice editable', async () => {
  const { ui, step } = await resultStep({ catalogs: ['main', 'sales'] });
  const { page, made } = ui;
  try {
    assert.equal(await page.getByRole('button', { name: 'Advanced settings' }).count(), 0, 'the place is on Results, not under Advanced');
    const box = page.getByRole('region', { name: 'Where the result table lives' }).getByRole('group', { name: 'New catalog or schema' });
    await box.getByText('Needs CREATE SCHEMA on the catalog.', { exact: true }).waitFor();
    await box.getByRole('textbox', { name: 'New schema name' }).fill('mvp out');
    await box.getByText('the schema name can only use letters, digits, _ and -', { exact: true }).waitFor();
    assert.equal(await box.getByRole('button', { name: 'Create' }).isDisabled(), true, 'a bad name cannot be created (must-exclude)');
    await box.getByRole('textbox', { name: 'New schema name' }).fill('mvp_out');
    await box.getByRole('button', { name: 'Create' }).click();
    await box.getByText('Created main.mvp_out.', { exact: true }).waitFor();
    assert.ok(made.sqlCalls.some((c) => String(c.sql) === 'CREATE SCHEMA IF NOT EXISTS `main`.`mvp_out`'), 'one create through the shared helper');
    assert.equal(await step.getByLabel('Schema').inputValue(), 'mvp_out', 'the new schema is picked');
    await box.getByRole('combobox', { name: 'What to create' }).selectOption('catalog');
    await box.getByText('Needs CREATE CATALOG on the metastore.', { exact: true }).waitFor();
    made.state.sqlErrors = { 'CREATE CATALOG': 'PERMISSION_DENIED: User does not have CREATE CATALOG on Metastore' };
    await box.getByRole('textbox', { name: 'New catalog name' }).fill('mvp_cat');
    await box.getByRole('button', { name: 'Create' }).click();
    const refused = box.locator('[data-new-place-error]');
    await refused.waitFor();
    assert.match(await refused.innerText(), /^Inspire could not create it: .*CREATE CATALOG/);
    assert.equal(await box.getByRole('textbox', { name: 'New catalog name' }).inputValue(), 'mvp_cat', 'the name stays to fix or try again');
    assert.equal(await box.getByRole('button', { name: 'Create' }).isDisabled(), false);
    assert.deepEqual([await step.getByLabel('Catalog').inputValue(), await step.getByLabel('Schema').inputValue()], ['main', 'mvp_out'], 'a refused create leaves the picked place');
    await step.getByLabel('Catalog').selectOption('sales');
    await until(async () => (await step.getByLabel('Catalog').inputValue()) === 'sales', 'the catalog stays editable');
    assert.deepEqual(ui.pageErrors, ['Failed to load resource: the server responded with a status of 500 (Internal Server Error)'], 'the refused create is the only error');
  } finally {
    await ui.close();
  }
});
