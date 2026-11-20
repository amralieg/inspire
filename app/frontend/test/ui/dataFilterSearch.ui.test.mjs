import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-363: Data filter is a column search across every picked table. Typing "brand" lists only the columns whose name contains it.
// A row adds a filter to that one table. A name several tables have offers Apply to all, which filters every one of them at once.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const COL = (name, type, n) => ({ column_name: name, data_type: type, ordinal_position: n });
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: {
    [ORDERS]: [COL('order_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('amount', 'DECIMAL(12,2)', 3)],
    [CUSTOMERS]: [COL('customer_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('name', 'STRING', 3)],
  },
  readinessRows: [{ row_count: '1200' }],
};
const SHOTS = '/private/tmp/inspire_v15/shots/u2';

const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  // Get Started on a new form asks whether to save a business profile (REQ-364); these tests run without saving.
  await page.getByRole('button', { name: 'Run without saving' }).click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};

async function openSearch(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await page.locator('button[title="customers"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.getByRole('searchbox', { name: 'Search column names' }).waitFor({ timeout: 15000 });
  await until(async () => (await page.locator('[data-search-hint]').count()) === 1, 'the search hint shows once the columns are read', 15000);
}

test('typing brand lists only the columns whose name contains brand, case-insensitive, each with its table', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('BRAND');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    assert.deepEqual(await page.locator('[data-column-hit]').evaluateAll((els) => els.map((el) => el.getAttribute('data-column-hit'))), ['brand', 'brand'],
      'one row per table that has brand, and no other column');
    const rows = await page.locator('[data-column-hit="brand"][data-scope-row]').allInnerTexts();
    assert.equal(rows.length, 2, 'both tables have brand');
    assert.match(rows.join('\n'), /orders/);
    assert.match(rows.join('\n'), /customers/);
    const text = await page.locator('[data-column-search]').innerText();
    assert.doesNotMatch(text, /amount|order_id|customer_id/, 'columns without brand are not listed');
  } finally {
    await ui.close();
  }
});

test('Apply to all adds one filter to every table that has the column, and each table filter is removable on its own', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    const group = page.locator('[data-column-hit="brand"]').first();
    await group.waitFor({ timeout: 10000 });
    await group.getByRole('button', { name: /Apply to all/ }).click();
    await page.getByLabel('Value for brand in 2 tables').fill('Acme');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Apply to all tables' }).click();
    const inUse = page.locator('[data-filters-in-use]');
    await inUse.locator(`[data-filter-table="${ORDERS}"][data-scope-condition="brand"]`).waitFor({ timeout: 5000 });
    await inUse.locator(`[data-filter-table="${CUSTOMERS}"][data-scope-condition="brand"]`).waitFor({ timeout: 5000 });
    assert.match(await inUse.innerText(), /brand: is Acme/);
    await page.getByRole('button', { name: 'Remove row filter on brand in orders: is Acme' }).click();
    assert.equal(await inUse.locator(`[data-filter-table="${ORDERS}"][data-scope-condition="brand"]`).count(), 0, 'orders filter removed');
    assert.equal(await inUse.locator(`[data-filter-table="${CUSTOMERS}"][data-scope-condition="brand"]`).count(), 1, 'customers keeps its own filter');
    await until(() => made.sqlCalls.some((c) => /GROUP BY|COUNT\(\*\)/.test(c.sql) || c.sql.includes('row_count')), 'the rows are counted', 10000).catch(() => null);
  } finally {
    await ui.close();
  }
});

// REQ-370: a column read that lands late is applied to the scopes as they are when it lands. A change made to another table while the
// read is in flight is kept (the write used to replace the scopes it was given at the click).
test('a column read that lands late keeps a change made to another table while it was in flight', async () => {
  const hold = {};
  const ui = await openUi('launch', { ...STATE, hold });
  const { page } = ui;
  try {
    await openSearch(page);
    const search = page.getByRole('searchbox', { name: 'Search column names' });
    // orders is saved first, with amount left out, so its columns are already read when the late read starts.
    await search.fill('amount');
    await page.getByRole('checkbox', { name: 'Read amount in orders' }).uncheck();
    await page.locator('[data-left-out-column="orders.amount"]').waitFor({ timeout: 5000 });
    // Hold the next column read, then read brand in customers: its column names are not read yet, so its write waits for the hold.
    let release;
    hold['/columns'] = new Promise((resolve) => { release = resolve; });
    await search.fill('brand');
    await page.getByRole('checkbox', { name: 'Read brand in customers' }).uncheck();
    // While it is in flight, another change lands on orders: amount is read again.
    await search.fill('amount');
    await page.getByRole('checkbox', { name: 'Read amount in orders' }).check();
    await page.locator('[data-left-out-column="orders.amount"]').waitFor({ state: 'detached', timeout: 5000 });
    release();
    delete hold['/columns'];
    await page.locator('[data-left-out-column="customers.brand"]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-left-out-column="orders.amount"]').count(), 0, 'the later change to orders is kept');
  } finally {
    await ui.close();
  }
});

// REQ-372: the search lists every column whose name contains the text, one row per table. Each row has Row filter (a row filter on that
// column of that table) and Load groups (the groups of a text column). The Read box stays on the row.
test('REQ-372: each search row has Row filter and Load groups, and Load groups lists the groups of a text column', async () => {
  const ui = await openUi('launch', { ...STATE, groupCounts: [{ brand: 'Acme', records: 3 }, { brand: 'Globex', records: 2 }],
    groupCountsByColumn: { brand: [{ brand: 'Acme', records: 3 }, { brand: 'Globex', records: 2 }] } });
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    const row = page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`);
    await row.waitFor({ timeout: 10000 });
    assert.equal(await row.getByRole('button', { name: 'Row filter on brand in orders' }).count(), 1, 'Row filter is on the row');
    assert.equal(await row.getByRole('button', { name: 'Load groups on brand in orders' }).count(), 1, 'Load groups is on the row');
    assert.equal(await row.getByRole('checkbox', { name: 'Read brand in orders' }).count(), 1, 'the Read box stays on the row');
    await row.getByRole('button', { name: 'Load groups on brand in orders' }).click();
    await page.locator('[data-row-groups="brand"] [data-group-value="Acme"]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-row-groups="brand"] [data-group-value]').count(), 2, 'the groups of the column are listed');
    await row.getByRole('button', { name: 'Row filter on brand in orders' }).click();
    assert.equal(await page.getByRole('group', { name: 'New row filter on brand in orders' }).count(), 1, 'Row filter opens the filter on that table');
  } finally {
    await ui.close();
  }
});

test('a row adds a filter to just that table, and the empty states say what to do', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    const search = page.getByRole('searchbox', { name: 'Search column names' });
    await search.fill('zzz');
    assert.match(await page.locator('[data-search-none]').innerText(), /No column name contains "zzz" in the 2 tables you picked/);
    await search.fill('name');
    await page.locator('[data-column-hit="name"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Row filter on name in customers' }).click();
    await page.getByLabel('Value for name in customers').fill('Ada');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.locator(`[data-filter-table="${CUSTOMERS}"][data-scope-condition="name"]`).waitFor({ timeout: 5000 });
    assert.equal(await page.locator(`[data-filter-table="${ORDERS}"]`).count(), 0, 'orders gets no filter');
    await search.fill('');
    assert.match(await page.locator('[data-search-hint]').innerText(), /Type a column name to find it in the 2 tables you picked/);
  } finally {
    await ui.close();
  }
});

test('the column search fits 1280x800 with filters in use, and the picture is saved for review', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    const search = page.getByRole('searchbox', { name: 'Search column names' });
    await search.fill('brand');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Apply to all/ }).click();
    await page.getByLabel('Value for brand in 2 tables').fill('Acme');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Apply to all tables' }).click();
    await page.locator('[data-filters-in-use]').waitFor({ timeout: 5000 });
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at ${width}x${height} (overflow ${sideways}px)`);
      await page.locator('[data-data-management]').screenshot({ path: `${SHOTS}/req363-data-filter-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});

// Read (REQ-363, the column ticks of the old grid): a column Inspire does not read is left out of the run scope, listed under
// Filters in use, and stays left out after a reload.
async function reopenSearch(page) {
  await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
  await idle(page);
  // A reload may restore the Advanced panel open, so each disclosure is opened only when it is closed.
  for (const name of [/Advanced Settings/, /Data Management \(optional\)/]) {
    const toggle = page.getByRole('button', { name });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }
  await page.getByRole('searchbox', { name: 'Search column names' }).fill('amount');
}

test('Read: unticking a column leaves it out of the run scope, names it under Filters in use, and a reload keeps it unticked', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('amount');
    const read = page.getByRole('checkbox', { name: 'Read amount in orders' });
    await read.waitFor({ timeout: 10000 });
    assert.equal(await read.isChecked(), true, 'every column starts read');
    await read.uncheck();
    await page.locator('[data-left-out-column="orders.amount"]').waitFor({ timeout: 5000 });
    assert.match(await page.locator('[data-columns-left-out]').innerText(), /Columns left out: 1/);
    // Reload before the launch: a sent launch clears the Launch draft.
    await page.reload();
    await reopenSearch(page);
    await page.getByRole('checkbox', { name: 'Read amount in orders' }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('checkbox', { name: 'Read amount in orders' }).isChecked(), false, 'the untick is restored from the draft');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope'])[ORDERS].columns, ['order_id', 'brand'], 'the run scope omits amount');
  } finally {
    await ui.close();
  }
});

test('Read in all tables: one box reads or leaves out a column in every table that has it, and the list follows', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    const all = page.getByRole('checkbox', { name: 'Read brand in all 2 tables' });
    await all.waitFor({ timeout: 10000 });
    await all.uncheck();
    assert.equal(await page.getByRole('checkbox', { name: 'Read brand in orders' }).isChecked(), false, 'orders leaves brand out');
    assert.equal(await page.getByRole('checkbox', { name: 'Read brand in customers' }).isChecked(), false, 'customers leaves brand out');
    await page.locator('[data-left-out-column="orders.brand"]').waitFor({ timeout: 5000 });
    await page.locator('[data-left-out-column="customers.brand"]').waitFor({ timeout: 5000 });
    await all.check();
    await until(async () => (await page.locator('[data-columns-left-out]').count()) === 0, 're-reading every column clears the list');
  } finally {
    await ui.close();
  }
});

// REQ-370: the column search is one server-side search over the whole picked scope, so a 550-table schema is searched whole. Its answer is
// capped at 300 hits with the total, and no table is read one at a time for the search.
test('a schema of 550 tables: the search finds a column in the last table, with no "not searched" note and no table-count cap', async () => {
  const names = Array.from({ length: 550 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`);
  const columnsByTable = Object.fromEntries(names.map((n, i) => [`main.s.${n}`, [COL('id', 'BIGINT', 1), COL(i === 549 ? 'zz_only' : 'name', 'STRING', 2)]]));
  const ui = await openUi('launch', { ...STATE, tables: { 'main.s': names }, columnsByTable });
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.getByRole('searchbox', { name: 'Search column names' }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-tables-not-searched]').count(), 0, 'no table is left out of the search');
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('zz_only');
    await page.locator('[data-column-hit="zz_only"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-column-hit="zz_only"][data-scope-row]').count(), 1, 'the one table in the last place is found');
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('name');
    await page.locator('[data-hits-capped]').waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-hits-capped]').innerText(), /Showing 300 of 549 matches\. Type more letters to narrow it down\./);
    const sizes = made.sqlCalls.filter((c) => /ILIKE :q/.test(c.sql)).length;
    assert.ok(sizes >= 1, 'the search is answered by the server');
    const perTable = made.sqlCalls.filter((c) => /implement\/columns|information_schema\.columns WHERE table_schema/.test(c.sql) && !/ILIKE/.test(c.sql)).length;
    assert.equal(perTable, 0, 'the search reads no table one at a time');
  } finally {
    await ui.close();
  }
});

// REQ-377: "Your filters (N)" appears only once a row filter exists. A column left out alone is named, but no Filters block is shown.
test('REQ-377: no Filters block until a row filter exists, then it reads Your filters (N); Columns left out shows only when some are left out', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('amount');
    await page.getByRole('checkbox', { name: 'Read amount in orders' }).uncheck();
    await page.locator('[data-left-out-column="orders.amount"]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('[data-filters-in-use]').count(), 0, 'a left-out column alone shows no Filters block');
    await page.getByRole('checkbox', { name: 'Read amount in orders' }).check();
    await page.locator('[data-left-out-column="orders.amount"]').waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await page.locator('[data-columns-left-out]').count(), 0, 'Columns left out is gone at 0');
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Row filter on brand in orders' }).click();
    await page.getByLabel('Value for brand in orders').fill('Acme');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.locator('[data-filters-in-use]').waitFor({ timeout: 5000 });
    assert.match(await page.locator('[data-filters-in-use]').innerText(), /Your filters \(1\)/);
  } finally {
    await ui.close();
  }
});

// REQ-379: a star at the start or the end of the search text is a wildcard. cust* finds the names that start with cust, *_id finds the
// names that end with a literal _id, and the hint under the box says so.
test('REQ-379: cust* lists the names that start with cust, *_id lists the names that end in _id, and the hint names the star', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    const box = page.getByRole('searchbox', { name: 'Search column names' });
    assert.match(await page.locator('[data-search-syntax]').innerText(), /Use \* at the start or end/, 'the hint says how to use the star');
    await box.fill('cust*');
    await page.locator('[data-column-hit="customer_id"]').waitFor({ timeout: 10000 });
    assert.deepEqual(await page.locator('[data-column-hit]').evaluateAll((els) => els.map((el) => el.getAttribute('data-column-hit'))), ['customer_id'],
      'cust* lists customer_id only');
    await box.fill('*_id');
    await page.locator('[data-column-hit="order_id"]').waitFor({ timeout: 10000 });
    const names = await page.locator('[data-column-hit]').evaluateAll((els) => els.map((el) => el.getAttribute('data-column-hit')).sort());
    assert.deepEqual(names, ['customer_id', 'order_id'], '*_id lists the two _id columns and not amount, brand or name');
  } finally {
    await ui.close();
  }
});

// REQ-380: when Load groups finds no groups, the one plain line says why: the table has no rows you can read, or the column is empty
// in every row. Both come from one count the route runs under the same filters.
test('REQ-380: Load groups on an empty column says why, in one plain line', async () => {
  const ui = await openUi('launch', { ...STATE, groupCounts: [], groupCountsByColumn: { brand: [] }, groupReasonRow: { rows_read: '1200', with_value: '0' } });
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    const row = page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`);
    await row.getByRole('button', { name: 'Load groups on brand in orders' }).click();
    const line = page.locator('[data-groups-reason="brand"]');
    await line.waitFor({ timeout: 10000 });
    assert.equal(await line.innerText(), 'brand is empty in all 1,200 rows', 'the reason names the column and the row count');
  } finally {
    await ui.close();
  }
});

test('REQ-380: a table with no rows you can read says so, not that the column is empty', async () => {
  const ui = await openUi('launch', { ...STATE, groupCounts: [], groupCountsByColumn: { brand: [] }, groupReasonRow: { rows_read: '0', with_value: '0' } });
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    const row = page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`);
    await row.getByRole('button', { name: 'Load groups on brand in orders' }).click();
    const line = page.locator('[data-groups-reason="brand"]');
    await line.waitFor({ timeout: 10000 });
    assert.equal(await line.innerText(), 'The table has no rows the App can read');
  } finally {
    await ui.close();
  }
});
