import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const ORDER_COLUMNS = ['brand_name', 'location', 'total_sales', 'store_id'].map((column_name, i) => ({
  column_name, data_type: i === 2 ? 'DOUBLE' : 'STRING', ordinal_position: i + 1,
}));
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders'] },
  columnsByTable: { [ORDERS]: ORDER_COLUMNS },
  valuesByColumn: { brand_name: ['Starbucks', 'Costa'] },
  readinessByFilter: { Starbucks: '120', Nobody: '0' },
};

const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};

async function pickOrdersAndOpenDataFilters(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Filters \(optional\)/ }).click();
  await page.locator(`[data-scope-table="${ORDERS}"] [data-scope-column="brand_name"]`).waitFor({ timeout: 15000 });
}

const summaryOf = (page) => page.locator(`[data-scope-table="${ORDERS}"] [data-scope-summary="${ORDERS}"]`).innerText();

test('Data Filters is an optional section in Advanced Settings, collapsed by default, and lists the picked table with its columns', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    const toggle = page.getByRole('button', { name: /Data Filters \(optional\)/ });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'the section is collapsed by default, like Strategy');
    assert.equal(await page.locator('[data-data-filters]').count(), 0, 'nothing is listed while the section is collapsed');
    await toggle.click();
    assert.equal(await page.locator(`[data-scope-table="${ORDERS}"]`).count(), 1, 'the picked table is listed');
    assert.equal(await page.locator(`[data-scope-table="${ORDERS}"] [data-scope-column]`).count(), 4, 'every column is offered, in the column filters');
    assert.equal(await page.locator(`[data-scope-table="${ORDERS}"] [data-scope-column="brand_name"]`).isChecked(), true, 'every column is read until one is unticked');
    assert.equal(await summaryOf(page), 'All columns, all rows', 'a table with no filter is read whole');
    assert.equal(await page.locator('[data-table-scope-open]').count(), 0, 'the per-table wizard entry point is gone: one way to set filters');
  } finally {
    await ui.close();
  }
});

test('column filters and row filters are set in Data Filters and reach the run as one scope, with no label unless ticked', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await page.locator(`[data-scope-table="${ORDERS}"] [data-scope-column="location"]`).uncheck();
    await page.getByRole('button', { name: 'Add a row filter' }).click();
    await page.getByLabel('Filter 1 column').selectOption('brand_name');
    await page.locator('[data-scope-value="Starbucks"]').click();
    await until(async () => (await summaryOf(page)).includes('120 rows match'), 'the live row count shows the rows the filter keeps');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope']), {
      [ORDERS]: {
        columns: ['brand_name', 'total_sales', 'store_id'],
        rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }],
      },
    }, 'the run carries the picked columns and the row filter, and no label because the box is not ticked');
  } finally {
    await ui.close();
  }
});

test('the label is prefilled from the row filters, disabled until ticked, and carried into the run as typed', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    const text = page.getByRole('textbox', { name: 'Use case label', exact: true });
    assert.equal(await text.isDisabled(), true, 'the label box is disabled while the tick box is unticked');
    await page.getByRole('button', { name: 'Add a row filter' }).click();
    await page.getByLabel('Filter 1 column').selectOption('brand_name');
    await page.locator('[data-scope-value="Starbucks"]').click();
    await until(async () => (await text.inputValue()) === 'Starbucks', 'the label is prefilled from the brand filter');
    await page.getByRole('checkbox', { name: 'Use case labeling enhanced using filters' }).check();
    assert.equal(await text.isDisabled(), false, 'ticking the box enables the label');
    await text.fill('Starbucks Cafe');
    const params = await launchOf(page, made);
    const scope = JSON.parse(params['17_table_scope']);
    assert.equal(scope.use_case_label, 'Starbucks Cafe', 'the typed label is the label the run carries, verbatim');
    assert.deepEqual(scope[ORDERS].rows, [{ column: 'brand_name', op: '=', values: ['Starbucks'] }]);
  } finally {
    await ui.close();
  }
});

test('a row filter that keeps 0 rows blocks Get Started, and a table with nothing set sends no scope', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await page.getByRole('button', { name: 'Add a row filter' }).click();
    await page.getByLabel('Filter 1 column').selectOption('brand_name');
    await page.getByLabel('Filter 1 value').fill('Nobody');
    await page.getByRole('button', { name: 'Add value' }).click();
    await until(async () => (await summaryOf(page)).includes('0 rows'), 'the section says the filter keeps 0 rows');
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).isDisabled(), true, 'a 0-row scope blocks the launch');
    assert.match(await page.locator(`[data-scope-table="${ORDERS}"] [role="alert"]`).innerText(), /its row filters keep 0 rows, so Inspire will not run them. Change a filter/);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await until(async () => (await summaryOf(page)) === 'All columns, all rows', 'removing the filter returns the table to read whole');
    const params = await launchOf(page, made);
    assert.equal('17_table_scope' in params, false, 'nothing is set, so the run reads the table whole');
  } finally {
    await ui.close();
  }
});

async function openDataFiltersAfter(page, pick) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await pick(page);
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Filters \(optional\)/ }).click();
}

test('a picked schema is a collapsed group that lists its tables when opened, and a filter on one reaches the run under catalog.schema.table', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openDataFiltersAfter(page, async (p) => {
      await p.locator('button[title="main"]').click();
      await p.locator('button[title="s"]').click();
    });
    const group = page.locator('[data-schema-group="main.s"]');
    await group.waitFor({ timeout: 15000 });
    assert.equal(await group.locator('> button').getAttribute('aria-expanded'), 'false', 'the schema group is collapsed by default');
    assert.equal(await page.locator(`[data-scope-table="${ORDERS}"]`).count(), 0, 'no table is listed until the schema is opened');
    await group.locator('> button').click();
    await page.locator(`[data-schema-group="main.s"] [data-scope-table="${ORDERS}"] [data-scope-column="brand_name"]`).waitFor({ timeout: 15000 });
    await page.locator(`[data-schema-group="main.s"] [data-scope-table="${ORDERS}"] [data-scope-column="location"]`).uncheck();
    await page.locator(`[data-schema-group="main.s"]`).getByRole('button', { name: 'Add a row filter' }).click();
    await page.locator(`[data-schema-group="main.s"]`).getByLabel('Filter 1 column').selectOption('brand_name');
    await page.locator('[data-scope-value="Starbucks"]').click();
    await until(async () => (await page.locator(`[data-schema-group="main.s"] [data-scope-table="${ORDERS}"] [data-scope-summary="${ORDERS}"]`).innerText()).includes('120 rows match'),
      'the filter on the table of the picked schema counts its rows');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope']), {
      [ORDERS]: { columns: ['brand_name', 'total_sales', 'store_id'], rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }] },
    }, 'the scope holds the table of the schema pick under its catalog.schema.table key');
    assert.equal(params['01_uc_metadata'].includes('main.s'), true, 'the run reads the picked schema');
  } finally {
    await ui.close();
  }
});

test('a picked catalog lists its schemas when opened, and each schema opens to its tables', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openDataFiltersAfter(page, async (p) => { await p.locator('button[title="main"]').click(); });
    const catalog = page.locator('[data-catalog-group="main"]');
    await catalog.waitFor({ timeout: 15000 });
    await catalog.locator('> button').click();
    const schema = page.locator('[data-schema-group="main.s"]');
    await schema.waitFor({ timeout: 15000 });
    assert.equal(await schema.locator('> button').getAttribute('aria-expanded'), 'false', 'a schema under a picked catalog is collapsed too');
    await schema.locator('> button').click();
    await page.locator(`[data-schema-group="main.s"] [data-scope-table="${ORDERS}"]`).waitFor({ timeout: 15000 });
    assert.equal(await page.locator(`[data-schema-group="main.s"] [data-scope-table="${ORDERS}"] [data-scope-column]`).count(), 4);
  } finally {
    await ui.close();
  }
});
