import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDER_COLUMNS = ['brand_name', 'location', 'total_sales', 'store_id'].map((column_name, i) => ({
  column_name, data_type: i === 2 ? 'DOUBLE' : 'STRING', ordinal_position: i + 1,
}));
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders'] },
  columnsByTable: { 'main.s.orders': ORDER_COLUMNS },
  valuesByColumn: { brand_name: ['Starbucks', 'Costa'] },
  readinessByFilter: { Starbucks: '120', Nobody: '0' },
};

const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};

async function openScopeWizardOnOrders(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await page.locator('[data-table-scope-open="main.s.orders"]').click();
  await page.locator('[data-table-scope-wizard="1"]').waitFor({ timeout: 15000 });
}

test('the Filter wizard has two steps: columns Inspire reads, then row filters with a live row count, and the scope reaches the run', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openScopeWizardOnOrders(page);
    assert.equal(await page.locator('[data-scope-column]').count(), 4, 'every column of the table is offered');
    assert.equal(await page.getByRole('button', { name: 'Next: row filters' }).isDisabled(), true, 'no column picked, so step 1 cannot go on');
    for (const column of ['brand_name', 'location', 'total_sales']) await page.locator(`[data-scope-column="${column}"]`).check();
    await page.getByRole('button', { name: 'Next: row filters' }).click();
    await page.locator('[data-table-scope-wizard="2"]').waitFor({ timeout: 15000 });

    await page.getByRole('button', { name: 'Add a row filter' }).click();
    await page.getByLabel('Filter 1 column').selectOption('brand_name');
    await page.locator('[data-scope-value="Starbucks"]').click();
    await until(async () => (await page.locator('[data-scope-count]').innerText()).includes('120 rows match this scope.'),
      'the live row count shows the rows the filter keeps');
    await page.getByRole('button', { name: 'Save scope' }).click();

    await page.locator('[data-table-scope-wizard]').first().waitFor({ state: 'detached', timeout: 15000 });
    assert.match(await page.locator('[data-table-scope-open="main.s.orders"]').innerText(), /3 columns, rows where brand_name is Starbucks/);
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope']), {
      'main.s.orders': {
        columns: ['brand_name', 'location', 'total_sales'],
        rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }],
      },
    }, 'the run carries the picked columns and the row filter, and nothing else');
  } finally {
    await ui.close();
  }
});

test('a row filter that keeps 0 rows blocks Save Scope, and the run carries no scope for a table never scoped', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openScopeWizardOnOrders(page);
    await page.locator('[data-scope-column="brand_name"]').check();
    await page.getByRole('button', { name: 'Next: row filters' }).click();
    await page.locator('[data-table-scope-wizard="2"]').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Add a row filter' }).click();
    await page.getByLabel('Filter 1 column').selectOption('brand_name');
    await page.getByLabel('Filter 1 value').fill('Nobody');
    await page.getByRole('button', { name: 'Add value' }).click();
    await until(async () => (await page.locator('[data-scope-count]').innerText()).includes('This scope has 0 rows'),
      'the wizard says the scope keeps 0 rows');
    assert.equal(await page.getByRole('button', { name: 'Save scope' }).isDisabled(), true, 'a 0-row scope cannot be saved');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.locator('[data-table-scope-wizard]').first().waitFor({ state: 'detached', timeout: 15000 });
    const params = await launchOf(page, made);
    assert.equal('17_table_scope' in params, false, 'nothing was scoped, so the run reads the table as the person picked it');
  } finally {
    await ui.close();
  }
});
