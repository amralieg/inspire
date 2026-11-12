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

const leafOf = (page) => page.locator(`[data-scope-table="${ORDERS}"]`);
const summaryOf = (page) => page.locator(`[data-scope-table="${ORDERS}"] [data-scope-summary="${ORDERS}"]`).innerText();
const gridOf = (page) => page.locator(`[data-column-grid="${ORDERS}"]`);
const boxOf = (page, column) => gridOf(page).locator(`[data-scope-column="${column}"]`);

// Opens the table's grid by clicking its leaf in the tree, and waits for its columns to load.
async function openGrid(page) {
  await leafOf(page).click();
  await boxOf(page, 'brand_name').waitFor({ timeout: 15000 });
}

// Adds one row filter to a column: the operator is "is" unless changed, the value is picked from the suggestions when it is offered.
async function addFilter(page, column, value) {
  await page.getByRole('button', { name: `Add row filter on ${column}` }).click();
  await page.locator(`[data-scope-value="${value}"]`).waitFor({ timeout: 15000 });
  await page.locator(`[data-scope-value="${value}"]`).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
}

async function pickOrdersAndOpenDataFilters(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Filters \(optional\)/ }).click();
  await leafOf(page).waitFor({ timeout: 15000 });
}

test('Data Filters is an optional section in Advanced Settings, collapsed by default, and the picked table sits in the tree under its schema and catalog', async () => {
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
    await leafOf(page).waitFor({ timeout: 15000 });
    assert.equal(await page.locator(`[data-catalog-group="main"] [data-schema-group="main.s"] [data-scope-table="${ORDERS}"]`).count(), 1,
      'the table sits under its schema, which sits under its catalog');
    assert.equal(await summaryOf(page), 'All columns, all rows', 'a table with no filter is read whole');
    assert.equal(await gridOf(page).count(), 0, 'no grid until a table is clicked');
    assert.match(await page.locator('[data-grid-empty]').innerText(), /Click a table on the left/);
    assert.equal(await page.locator('[data-table-scope-open]').count(), 0, 'the per-table wizard entry point is gone: one way to set filters');
  } finally {
    await ui.close();
  }
});

test('the tree nests catalog, schema and table with tree semantics, and each group expands and collapses', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    const tree = page.locator('[role="tree"]');
    assert.equal(await tree.count(), 1, 'the list is a tree');
    const catalog = page.locator('[data-catalog-group="main"] > [role="treeitem"]');
    const schema = page.locator('[data-schema-group="main.s"] > [role="treeitem"]');
    assert.equal(await catalog.getAttribute('aria-level'), '1', 'the catalog is level 1');
    assert.equal(await schema.getAttribute('aria-level'), '2', 'the schema is level 2');
    assert.equal(await leafOf(page).getAttribute('aria-level'), '3', 'the table is level 3');
    assert.equal(await catalog.getAttribute('aria-expanded'), 'true', 'a catalog holding a picked table opens by itself');
    assert.equal(await schema.getAttribute('aria-expanded'), 'true', 'a schema holding a picked table opens by itself');

    await catalog.click();
    assert.equal(await catalog.getAttribute('aria-expanded'), 'false', 'clicking the catalog collapses it');
    assert.equal(await leafOf(page).count(), 0, 'its tables are hidden while it is collapsed');
    await catalog.click();
    assert.equal(await catalog.getAttribute('aria-expanded'), 'true', 'clicking again expands it');
    await leafOf(page).waitFor({ timeout: 15000 });
    await schema.click();
    assert.equal(await schema.getAttribute('aria-expanded'), 'false', 'the schema collapses on its own');
    assert.equal(await leafOf(page).count(), 0, 'the schema collapse hides its table');
    await schema.click();
    await leafOf(page).waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('the tree works from the keyboard: arrows move and open or close groups, Enter opens a table', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    const schema = page.locator('[data-schema-group="main.s"] > [role="treeitem"]');
    await schema.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await schema.getAttribute('aria-expanded'), 'false', 'Left closes an open group');
    await page.keyboard.press('ArrowRight');
    assert.equal(await schema.getAttribute('aria-expanded'), 'true', 'Right opens a closed group');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-scope-table')), ORDERS, 'Down moves to the table inside the group');
    await page.keyboard.press('Enter');
    await boxOf(page, 'brand_name').waitFor({ timeout: 15000 });
    assert.equal(await leafOf(page).getAttribute('aria-selected'), 'true', 'Enter opens the table, which is highlighted');
    await page.keyboard.press('ArrowUp');
    assert.equal(await schema.getAttribute('aria-selected'), null, 'Up moves focus back to the schema');
  } finally {
    await ui.close();
  }
});

test('clicking a table opens its grid with one row per column, all ticked, and one grid at a time', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await openGrid(page);
    const rows = gridOf(page).locator('tbody tr');
    assert.deepEqual(await rows.evaluateAll((trs) => trs.map((tr) => tr.dataset.scopeRow)), ['brand_name', 'location', 'total_sales', 'store_id'],
      'one grid row per column, in table order');
    assert.equal(await gridOf(page).locator('[data-scope-column]:checked').count(), 4, 'every column is ticked by default');
    assert.equal(await leafOf(page).getAttribute('aria-selected'), 'true', 'the selected table is highlighted');
    assert.match(await gridOf(page).innerText(), /4 of 4 columns ticked/);
    assert.match(await gridOf(page).innerText(), /DOUBLE/, 'each column shows its type');
    assert.equal(await page.locator('[data-column-grid]').count(), 1, 'one grid is open at a time');
  } finally {
    await ui.close();
  }
});

test('Select all and Unselect all tick and clear every column, and an empty column list says so in the grid', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await openGrid(page);
    await gridOf(page).getByRole('button', { name: 'Unselect all' }).click();
    await until(async () => (await gridOf(page).locator('[data-scope-column]:checked').count()) === 0, 'Unselect all clears every box');
    assert.match(await gridOf(page).locator('[role="alert"]').innerText(), /Pick at least one column for this table\./,
      'the grid says a table needs one column');
    await gridOf(page).getByRole('button', { name: 'Select all', exact: true }).click();
    await until(async () => (await gridOf(page).locator('[data-scope-column]:checked').count()) === 4, 'Select all ticks every box');
    assert.equal(await gridOf(page).locator('[role="alert"]').count(), 0, 'the problem clears once a column is ticked');
  } finally {
    await ui.close();
  }
});

test('unticking a column drops it from the scope, and a row filter adds {column, op, values} and counts the rows', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await openGrid(page);
    await boxOf(page, 'location').uncheck();
    await until(async () => (await summaryOf(page)).startsWith('3 of 4 columns'), 'the summary counts the ticked columns');
    await addFilter(page, 'brand_name', 'Starbucks');
    await until(async () => (await summaryOf(page)).includes('120 rows match'), 'the live row count shows the rows the filter keeps');
    assert.equal(await gridOf(page).locator('[data-scope-condition="brand_name"]').innerText(), 'is Starbucks', 'the condition shows as a chip');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope']), {
      [ORDERS]: {
        columns: ['brand_name', 'total_sales', 'store_id'],
        rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }],
      },
    }, 'the run carries the ticked columns and the row filter, and no label because the box is not ticked');
  } finally {
    await ui.close();
  }
});

test('a column can carry more than one row filter, and each is removable as a chip', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await openGrid(page);
    await page.getByRole('button', { name: 'Add row filter on brand_name' }).click();
    await page.getByLabel('Operator for brand_name').selectOption('!=');
    await page.locator('[data-scope-value="Costa"]').waitFor({ timeout: 15000 });
    await page.locator('[data-scope-value="Costa"]').click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await addFilter(page, 'brand_name', 'Starbucks');
    assert.equal(await gridOf(page).locator('[data-scope-condition="brand_name"]').count(), 2, 'two chips on one column');
    assert.match(await summaryOf(page), /2 row filters/);
    await page.getByRole('button', { name: 'Remove row filter on brand_name: is not Costa' }).click();
    assert.equal(await gridOf(page).locator('[data-scope-condition="brand_name"]').count(), 1, 'Remove drops one chip');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope'])[ORDERS].rows, [{ column: 'brand_name', op: '=', values: ['Starbucks'] }]);
  } finally {
    await ui.close();
  }
});

test('an unticked column cannot get a row filter, and unticking a column drops its filters with a one-line note', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await openGrid(page);
    await boxOf(page, 'location').uncheck();
    const add = gridOf(page).locator('[data-scope-row="location"] button[aria-label="Add row filter on location"]');
    assert.equal(await add.isDisabled(), true, 'the Add button is disabled on an unticked column');
    assert.match(await gridOf(page).locator('[data-scope-row="location"]').innerText(), /Tick location to add a row filter to it\./);
    await boxOf(page, 'location').check();
    assert.equal(await add.isDisabled(), false, 'ticking the column enables its Add button');

    await addFilter(page, 'brand_name', 'Starbucks');
    await until(async () => (await summaryOf(page)).includes('120 rows match'), 'the brand filter counts its rows');
    await boxOf(page, 'brand_name').uncheck();
    await until(async () => (await gridOf(page).locator('[data-scope-condition]').count()) === 0, 'unticking the column drops its filter');
    assert.match(await gridOf(page).locator('[data-scope-note="dropped"]').innerText(),
      /Removed 1 row filter on brand_name: a column Inspire does not read cannot be filtered\./, 'the one-line note says what was dropped and why');
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).isDisabled(), false, 'no filter is left on an unticked column, so the launch is open');
    assert.equal(await gridOf(page).locator('[role="alert"]').count(), 0, 'no problem is raised for it');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope']), {
      [ORDERS]: { columns: ['location', 'total_sales', 'store_id'], rows: [] },
    }, 'the run reads the three ticked columns with no row filter, so the dropped filter is not sent');
  } finally {
    await ui.close();
  }
});

test('the label is still filled in from the row filters, disabled until ticked, and carried into the run as typed', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    const text = page.getByRole('textbox', { name: 'Use case label', exact: true });
    assert.equal(await text.isDisabled(), true, 'the label box is disabled while the tick box is unticked');
    await openGrid(page);
    await addFilter(page, 'brand_name', 'Starbucks');
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

test('a row filter that keeps 0 rows blocks Get Started, and removing it sends no scope', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await openGrid(page);
    await page.getByRole('button', { name: 'Add row filter on brand_name' }).click();
    await page.getByLabel('Value for brand_name').fill('Nobody');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await until(async () => (await summaryOf(page)).includes('0 rows match'), 'the summary says the filter keeps 0 rows');
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).isDisabled(), true, 'a 0-row scope blocks the launch');
    assert.match(await gridOf(page).locator('[role="alert"]').innerText(), /its row filters keep 0 rows, so Inspire will not run them. Change a filter/);
    await page.getByRole('button', { name: 'Remove row filter on brand_name: is Nobody' }).click();
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
    const schema = page.locator('[data-schema-group="main.s"] > [role="treeitem"]');
    await schema.waitFor({ timeout: 15000 });
    assert.equal(await schema.getAttribute('aria-expanded'), 'false', 'the picked schema is collapsed until opened');
    assert.equal(await leafOf(page).count(), 0, 'no table is listed until the schema is opened');
    await schema.click();
    await leafOf(page).waitFor({ timeout: 15000 });
    await leafOf(page).click();
    await boxOf(page, 'brand_name').waitFor({ timeout: 15000 });
    await boxOf(page, 'location').uncheck();
    await addFilter(page, 'brand_name', 'Starbucks');
    await until(async () => (await summaryOf(page)).includes('120 rows match'), 'the filter on the table of the picked schema counts its rows');
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
    const catalog = page.locator('[data-catalog-group="main"] > [role="treeitem"]');
    await catalog.waitFor({ timeout: 15000 });
    assert.equal(await catalog.getAttribute('aria-expanded'), 'false', 'a picked catalog with nothing under it is collapsed');
    await catalog.click();
    const schema = page.locator('[data-schema-group="main.s"] > [role="treeitem"]');
    await schema.waitFor({ timeout: 15000 });
    assert.equal(await schema.getAttribute('aria-expanded'), 'false', 'a schema under a picked catalog is collapsed too');
    await schema.click();
    await leafOf(page).waitFor({ timeout: 15000 });
    await until(async () => (await page.locator(`[data-scope-table="${ORDERS}"]`).count()) === 1, 'the table lists under its schema once loaded');
    await leafOf(page).click();
    await until(async () => (await gridOf(page).locator('[data-scope-column]').count()) === 4, 'the grid lists its four columns once they load');
  } finally {
    await ui.close();
  }
});

test('a column tick reads ticked before a click, unticked after it, and the table summary follows the same click', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickOrdersAndOpenDataFilters(page);
    await openGrid(page);
    const location = boxOf(page, 'location');
    assert.equal(await location.isChecked(), true, 'before the click: every column starts ticked, so Inspire reads it');
    assert.equal(await summaryOf(page), 'All columns, all rows', 'before the click: the table reads whole');
    await location.click();
    assert.equal(await location.isChecked(), false, 'after the click: the tick is off');
    await until(async () => (await summaryOf(page)) === '3 of 4 columns', 'after the click: the summary reads 3 of 4 columns');
    await location.click();
    assert.equal(await location.isChecked(), true, 'after the second click: the tick is back on');
    await until(async () => (await summaryOf(page)) === 'All columns, all rows', 'after the second click: the table reads whole again');
  } finally {
    await ui.close();
  }
});
