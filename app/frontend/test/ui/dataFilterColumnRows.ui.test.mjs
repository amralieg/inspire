import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-384: the column search lists matching columns only, one flat row per (table, column). Every row starts with its column name, so
// no row reads as a table. Exact names come first, then names that start with the text, then names that contain it.
// REQ-385: each row is one dotted name, <..>.table.column, with the column highlighted. <..> is catalog.schema. "Collapse names" (ticked
// by default, remembered in this browser) shows every row collapsed or expanded, and a click on <..> expands one row in place.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const SHOTS = '/private/tmp/inspire_v15/shots/u8';
const COL = (name, type, n) => ({ column_name: name, data_type: type, ordinal_position: n });
const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const SEGMENT = 'main.s.segment_rollup';
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers', 'segment_rollup'] },
  columnsByTable: {
    [ORDERS]: [COL('order_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('amount', 'DECIMAL(12,2)', 3)],
    [CUSTOMERS]: [COL('customer_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('segment', 'STRING', 3)],
    [SEGMENT]: [COL('segment', 'STRING', 1), COL('segment_id', 'BIGINT', 2), COL('customer_segment', 'STRING', 3)],
  },
  readinessRows: [{ row_count: '1200' }],
};

// Opens Data Management with the three tables picked, so the search reads all of them.
async function openSearch(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await page.locator('button[title="customers"]').click();
  await page.locator('button[title="segment_rollup"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.getByRole('searchbox', { name: 'Search column names' }).waitFor({ timeout: 15000 });
  await until(async () => (await page.locator('[data-search-hint]').count()) === 1, 'the search hint shows once the columns are read', 15000);
}

// The column name of each listed row, in the order the rows are listed.
const rowNames = (page) => page.locator('[data-column-hit]').evaluateAll((els) => els.map((el) => el.getAttribute('data-column-hit')));
// The dotted name each row shows, as the person reads it.
const dottedNames = (page) => page.locator('[data-column-hit] [data-dotted-name]').evaluateAll((els) => els.map((el) => el.textContent));
const rowOf = (page, column, table) => page.locator(`[data-column-hit="${column}"][data-scope-row="${table}"]`);

test('REQ-384: a search lists matching columns only, each row starts with its column name, and exact names come before starts-with and contains', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('segment');
    await page.locator('[data-column-hit="segment"]').first().waitFor({ timeout: 10000 });
    // The four rows: segment in customers, segment in segment_rollup (exact), segment_id (starts with), customer_segment (contains).
    assert.deepEqual(await rowNames(page), ['segment', 'segment', 'segment_id', 'customer_segment'], 'rank: exact, then starts with, then contains');
    // The first thing in each row is a dotted name whose last part is the matching column. No row is a table name or a header.
    const names = await dottedNames(page);
    assert.deepEqual(names.map((n) => n.split('.').pop()), ['segment', 'segment', 'segment_id', 'customer_segment'], 'each row ends with its column');
    assert.deepEqual(names, ['<..>.customers.segment', '<..>.segment_rollup.segment', '<..>.segment_rollup.segment_id', '<..>.segment_rollup.customer_segment'],
      'one row per table and column, with the table in the name');
    assert.equal(await page.locator('[data-column-hits] > li').count(), 4, 'the list has one li per match, and no group headers');
    assert.equal(await page.locator('[data-column-hit="order_id"], [data-column-hit="brand"]').count(), 0, 'columns without segment are not listed');
    assert.match(await page.locator('[data-column-search]').innerText(), /4 columns in 2 tables match\./, 'the summary counts names and rows');
    assert.match(await page.locator('[data-search-syntax]').innerText(), /Use \* at the start or end/, 'the wildcard hint stays');
  } finally {
    await ui.close();
  }
});

test('REQ-384: Apply to all sits on the first row of a column name only, and Read in all sits beside it', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('segment');
    await rowOf(page, 'segment', CUSTOMERS).waitFor({ timeout: 10000 });
    const first = rowOf(page, 'segment', CUSTOMERS);
    const second = rowOf(page, 'segment', SEGMENT);
    assert.equal(await first.getByRole('button', { name: 'Apply to all on segment in 2 tables' }).count(), 1, 'the first row carries Apply to all');
    assert.equal(await second.getByRole('button', { name: /Apply to all/ }).count(), 0, 'the second row does not');
    assert.equal(await first.getByRole('checkbox', { name: 'Read segment in all 2 tables' }).count(), 1, 'Read in all is on the first row');
    assert.equal(await second.getByRole('checkbox', { name: 'Read segment in all 2 tables' }).count(), 0, 'Read in all is not repeated');
    assert.equal(await page.getByRole('button', { name: /Apply to all on/ }).count(), 1, 'one Apply to all for the whole list');
    await page.getByRole('button', { name: 'Apply to all on segment in 2 tables' }).click();
    await page.getByLabel('Value for segment in 2 tables').fill('Gold');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Apply to all tables' }).click();
    const inUse = page.locator('[data-filters-in-use]');
    await inUse.locator(`[data-filter-table="${CUSTOMERS}"][data-scope-condition="segment"]`).waitFor({ timeout: 5000 });
    await inUse.locator(`[data-filter-table="${SEGMENT}"][data-scope-condition="segment"]`).waitFor({ timeout: 5000 });
  } finally {
    await ui.close();
  }
});

test('REQ-384: the matched part is highlighted inside the column name, and the search screenshots are saved at 1440x900 and 1280x800', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('segment');
    await page.locator('[data-column-hit="segment_id"]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-column-hit="segment_id"] mark').innerText(), 'segment', 'the match is marked');
    assert.equal(await page.locator('[data-column-hit="segment_id"] [data-dotted-name] mark').count(), 1, 'the mark is inside the dotted name');
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at ${width}x${height} (overflow ${sideways}px)`);
      await page.locator('[data-data-management]').screenshot({ path: `${SHOTS}/req384-req385-segment-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});

test('REQ-385: Collapse names is ticked by default, every row shows <..>.table.column', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    assert.equal(await page.getByRole('checkbox', { name: 'Collapse names' }).isChecked(), true, 'ticked by default');
    assert.deepEqual(await dottedNames(page), ['<..>.customers.brand', '<..>.orders.brand'], 'every row is collapsed');
  } finally {
    await ui.close();
  }
});

test('REQ-385: unticked, every row shows catalog.schema.table.column, and the choice is kept after a reload', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    await page.getByRole('checkbox', { name: 'Collapse names' }).uncheck();
    assert.deepEqual(await dottedNames(page), ['main.s.customers.brand', 'main.s.orders.brand'], 'every row is expanded');
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
    for (const name of [/Advanced Settings/, /Data Management \(optional\)/]) {
      const toggle = page.getByRole('button', { name });
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    }
    assert.equal(await page.getByRole('checkbox', { name: 'Collapse names' }).isChecked(), false, 'the untick is remembered in this browser');
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    assert.deepEqual(await dottedNames(page), ['main.s.customers.brand', 'main.s.orders.brand'], 'the rows stay expanded after the reload');
  } finally {
    await ui.close();
  }
});

test('REQ-385: a click on <..> expands that one row in place, and a second click collapses it', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    await rowOf(page, 'brand', ORDERS).getByRole('button', { name: 'Show the catalog and schema of brand in orders' }).click();
    assert.deepEqual(await dottedNames(page), ['<..>.customers.brand', 'main.s.orders.brand'], 'only the orders row expands');
    assert.equal(await rowOf(page, 'brand', ORDERS).getByRole('button', { name: 'Hide the catalog and schema of brand in orders' }).getAttribute('aria-expanded'), 'true');
    await rowOf(page, 'brand', ORDERS).getByRole('button', { name: 'Hide the catalog and schema of brand in orders' }).click();
    assert.deepEqual(await dottedNames(page), ['<..>.customers.brand', '<..>.orders.brand'], 'a second click collapses the row again');
  } finally {
    await ui.close();
  }
});

test('REQ-385: unticked, a click on <..> collapses that one row, and ticking again clears the per-row choices', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    await page.getByRole('checkbox', { name: 'Collapse names' }).uncheck();
    await rowOf(page, 'brand', CUSTOMERS).getByRole('button', { name: 'Hide the catalog and schema of brand in customers' }).click();
    assert.deepEqual(await dottedNames(page), ['<..>.customers.brand', 'main.s.orders.brand'], 'only the customers row collapses');
    await page.getByRole('checkbox', { name: 'Collapse names' }).check();
    assert.deepEqual(await dottedNames(page), ['<..>.customers.brand', '<..>.orders.brand'], 'ticking collapses every row');
  } finally {
    await ui.close();
  }
});
