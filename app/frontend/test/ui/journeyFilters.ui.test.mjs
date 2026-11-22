import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-470: the Data filter walked the way a business user does: open, search, filter, save (launch), reload, undo, empty and error states,
// long names, and the two screen sizes with no sideways scroll and no console error.
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
  groupCounts: [{ brand: 'North', records: 700 }, { brand: 'South', records: 500 }],
  groupCountsByColumn: { brand: [{ brand: 'North', records: 700 }, { brand: 'South', records: 500 }] },
};
const SEARCH = { name: 'Search column names' };
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];

async function pick(page, tables = ['orders', 'customers']) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  for (const t of tables) await page.locator(`button[title="${t}"]`).click();
  await idle(page);
}

async function openSection(page, ready = true) {
  for (const name of [/Advanced Settings/, /Data Management \(optional\)/]) {
    const toggle = page.getByRole('button', { name });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }
  if (ready) await page.getByRole('searchbox', SEARCH).waitFor({ timeout: 15000 });
}

async function open(page, tables) {
  await pick(page, tables);
  await openSection(page);
}

async function addFilter(page, table, column, op, values) {
  await page.getByRole('button', { name: `Row filter on ${column} in ${table}` }).click();
  if (op) await page.getByLabel(`Operator for ${column} in ${table}`).selectOption({ label: op });
  for (const v of values) {
    await page.getByLabel(`Value for ${column} in ${table}`).fill(v);
    await page.getByRole('button', { name: 'Add value' }).click();
  }
  await page.getByRole('button', { name: 'Add filter' }).click();
}

const noSideways = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

async function launched(page, made) {
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Run without saving' }).click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  const text = made.launches[0].params['17_table_scope'];
  return text ? JSON.parse(text) : {};
}

test('filter journey: add a value filter, see it in Your filters, launch carries it, a reload keeps it, Remove clears it, and the launch then carries none', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await open(page);
    await page.getByRole('searchbox', SEARCH).fill('brand');
    await page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`).waitFor({ timeout: 10000 });
    await addFilter(page, 'orders', 'brand', null, ['Acme']);
    const inUse = page.locator('[data-filters-in-use]');
    await inUse.waitFor({ timeout: 5000 });
    assert.match(await inUse.innerText(), /Your filters \(1\)/);
    assert.match(await inUse.innerText(), /brand: is Acme/);
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
    await openSection(page);
    await page.locator('[data-filters-in-use]').waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-filters-in-use]').innerText(), /brand: is Acme/, 'the filter is restored after a reload');
    await page.getByRole('button', { name: 'Remove row filter on brand in orders: is Acme' }).click();
    await until(async () => (await page.locator('[data-filters-in-use]').count()) === 0, 'removing the last filter closes Your filters');
    const scope = await launched(page, made);
    assert.deepEqual(scope[ORDERS]?.rows ?? [], [], 'no filter is sent once removed');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('filter journey: the launch carries the filter that was saved', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await open(page);
    await page.getByRole('searchbox', SEARCH).fill('brand');
    await page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`).waitFor({ timeout: 10000 });
    await addFilter(page, 'orders', 'brand', null, ['Acme']);
    await page.locator('[data-filters-in-use]').waitFor({ timeout: 5000 });
    const scope = await launched(page, made);
    assert.deepEqual(scope[ORDERS].rows.map((f) => ({ column: f.column, op: f.op, values: f.values })), [{ column: 'brand', op: '=', values: ['Acme'] }]);
    assert.equal((scope[CUSTOMERS]?.rows ?? []).length, 0, 'the other table is not filtered');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every operator in the filter form can be chosen and offers the right inputs, with no page error', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await open(page);
    await page.getByRole('searchbox', SEARCH).fill('amount');
    await page.locator(`[data-column-hit="amount"]`).first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Row filter on amount in orders' }).click();
    const select = page.getByLabel('Operator for amount in orders');
    const options = await select.locator('option').evaluateAll((os) => os.map((o) => ({ value: o.value, label: o.textContent })));
    assert.ok(options.length >= 5, `the form offers several operators, got ${options.length}`);
    for (const o of options) {
      await select.selectOption(o.value);
      assert.equal(await select.inputValue(), o.value, `${o.label} can be chosen`);
      const add = page.getByRole('button', { name: 'Add filter' });
      const needsValue = await page.getByLabel('Value for amount in orders').count();
      if (needsValue) assert.equal(await add.isDisabled(), true, `${o.label}: Add filter waits for a value`);
      else assert.equal(await add.isDisabled(), false, `${o.label}: needs no value, so it can be added`);
    }
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.getByLabel('Operator for amount in orders').count(), 0, 'Cancel closes the form without adding a filter');
    assert.equal(await page.locator('[data-filters-in-use]').count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a value can be removed from the draft before it is added, and a duplicate value is not added twice', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await open(page);
    await page.getByRole('searchbox', SEARCH).fill('brand');
    await page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Row filter on brand in orders' }).click();
    await page.getByLabel('Operator for brand in orders').selectOption({ label: 'is one of' });
    for (const v of ['Acme', 'Acme', 'Zed']) {
      await page.getByLabel('Value for brand in orders').fill(v);
      await page.getByRole('button', { name: 'Add value' }).click();
    }
    assert.equal(await page.getByRole('button', { name: /Remove value / }).count(), 2, 'Acme once and Zed once');
    await page.getByRole('button', { name: 'Remove value Acme' }).click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    assert.match(await page.locator('[data-filters-in-use]').innerText(), /brand: is one of Zed/);
    assert.doesNotMatch(await page.locator('[data-filters-in-use]').innerText(), /Acme/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Load groups lists the groups, Select all and Clear work, and picked groups show in Your filters', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await open(page);
    await page.getByRole('searchbox', SEARCH).fill('brand');
    const row = page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`);
    await row.waitFor({ timeout: 10000 });
    await row.getByRole('button', { name: 'Load groups on brand in orders' }).click();
    const list = page.getByRole('list', { name: 'Groups of brand' });
    await list.waitFor({ timeout: 10000 });
    assert.equal(await list.locator('input[type=checkbox]').count(), 2);
    await row.getByRole('button', { name: 'Select all' }).click();
    assert.equal(await list.locator('input:checked').count(), 2, 'Select all ticks both groups');
    await row.getByRole('button', { name: 'Clear' }).click();
    assert.equal(await list.locator('input:checked').count(), 0, 'Clear unticks them');
    await list.locator('[data-group-value="North"]').check();
    await page.locator('[data-filters-in-use]').waitFor({ timeout: 5000 });
    assert.match(await page.locator('[data-filters-in-use]').innerText(), /groups: North/);
    const scope = await launched(page, made);
    assert.ok(JSON.stringify(scope[ORDERS].rows).includes('North'), 'the launch carries the picked group');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('empty states: no table picked, nothing typed, and a name no column has each say what to do', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await idle(page);
    await openSection(page, false);
    assert.match(await page.locator('[data-data-filters-empty]').innerText(), /Pick tables above/);
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.locator('[data-search-hint]').waitFor({ timeout: 15000 });
    await page.getByRole('searchbox', SEARCH).fill('zzzznope');
    const none = page.locator('[data-search-none]');
    await none.waitFor({ timeout: 10000 });
    assert.match(await none.innerText(), /No column name contains "zzzznope" in the 1 table you picked/);
    await page.getByRole('searchbox', SEARCH).fill('');
    await page.locator('[data-search-hint]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('[data-column-hit]').count(), 0, 'clearing the search clears the list');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

for (const [status, body] of [[500, { error: 'The warehouse is not reachable right now.' }], [400, { error: 'The search text is not valid.' }]]) {
  test(`error state: the column search answering ${status} says so in plain words, and Try again recovers`, async () => {
    let fail = true;
    const mount = (app) => app.post('/api/data-management/columns', (req, res, next) => (fail ? res.status(status).json(body) : next()));
    const ui = await openUi('launch', STATE, '', { mount });
    const { page } = ui;
    try {
      await open(page);
      await page.getByRole('searchbox', SEARCH).fill('brand');
      const alert = page.locator('[data-column-search] [role="alert"]').first();
      await alert.waitFor({ timeout: 10000 });
      assert.equal((await alert.innerText()).trim(), body.error);
      assert.equal(await page.locator('[data-column-hit]').count(), 0, 'no stale hit is shown beside the error');
      fail = false;
      await page.getByRole('button', { name: 'Try again' }).first().click();
      await page.locator('[data-column-hit="brand"]').first().waitFor({ timeout: 10000 });
      assert.equal(await page.locator('[data-column-search] [role="alert"]').count(), 0, 'the error is gone after the retry');
    } finally {
      await ui.close();
    }
  });
}

test('error state: counting the rows of a filtered table fails with a 500, and the page stays usable', async () => {
  const mount = (app) => app.post('/api/inspire/implement/readiness', (req, res) => res.status(500).json({ error: 'The rows could not be counted.' }));
  const ui = await openUi('launch', STATE, '', { mount });
  const { page, pageErrors } = ui;
  try {
    await open(page);
    await page.getByRole('searchbox', SEARCH).fill('brand');
    await page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`).waitFor({ timeout: 10000 });
    await addFilter(page, 'orders', 'brand', null, ['Acme']);
    await page.locator('[data-filters-in-use]').waitFor({ timeout: 5000 });
    await idle(page);
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).isVisible(), true);
    const text = await page.locator('[data-data-filters]').innerText();
    assert.doesNotMatch(text, /undefined|NaN|\[object/, 'no raw value leaks into the screen');
    assert.deepEqual(pageErrors.filter((e) => !/500/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('long table and column names wrap inside the section at both screen sizes, with a filter in use and no sideways scroll', async () => {
  const longTable = `a_very_long_table_name_${'x'.repeat(70)}`;
  const longColumn = `a_very_long_column_name_${'y'.repeat(70)}`;
  const full = `main.s.${longTable}`;
  const state = { ...STATE, tables: { 'main.s': [longTable] }, columnsByTable: { [full]: [COL(longColumn, 'STRING', 1), COL('id', 'BIGINT', 2)] } };
  for (const viewport of VIEWPORTS) {
    const ui = await openUi('launch', state);
    const { page, pageErrors } = ui;
    try {
      await page.setViewportSize(viewport);
      await open(page, [longTable]);
      await page.getByRole('searchbox', SEARCH).fill('very_long_column');
      await page.locator(`[data-column-hit="${longColumn}"]`).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: `Row filter on ${longColumn} in ${longTable}` }).click();
      await page.getByLabel(`Value for ${longColumn} in ${longTable}`).fill('v'.repeat(120));
      await page.getByRole('button', { name: 'Add value' }).click();
      await page.getByRole('button', { name: 'Add filter' }).click();
      await page.locator('[data-filters-in-use]').waitFor({ timeout: 5000 });
      const { sw, cw } = await noSideways(page);
      assert.ok(sw <= cw, `${viewport.width}x${viewport.height}: the page scrolls sideways (${sw} > ${cw})`);
      const box = await page.locator('[data-data-filters]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { right: r.right, names: [...el.querySelectorAll('*')].filter((c) => c.getBoundingClientRect().right > r.right + 1).map((c) => `${c.tagName}.${String(c.className).slice(0, 40)}:${(c.textContent || '').slice(0, 30)}`) };
      });
      assert.ok(box.right <= viewport.width, `${viewport.width}: the section ends inside the screen`);
      assert.deepEqual(box.names, [], `${viewport.width}: no control runs past the section edge`);
      assert.deepEqual(pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('the filter section with a search, two filters and left-out columns fits 1440x900 and 1280x800 without sideways scroll or console error', async () => {
  for (const viewport of VIEWPORTS) {
    const ui = await openUi('launch', STATE);
    const { page, pageErrors } = ui;
    try {
      await page.setViewportSize(viewport);
      await open(page);
      await page.getByRole('searchbox', SEARCH).fill('amount');
      await page.getByRole('checkbox', { name: 'Read amount in orders' }).uncheck();
      await page.getByRole('searchbox', SEARCH).fill('brand');
      await page.locator(`[data-column-hit="brand"][data-scope-row="${ORDERS}"]`).waitFor({ timeout: 10000 });
      await addFilter(page, 'orders', 'brand', null, ['Acme']);
      await addFilter(page, 'customers', 'brand', null, ['Zed']);
      await page.locator('[data-columns-left-out]').waitFor({ timeout: 5000 });
      const { sw, cw } = await noSideways(page);
      assert.ok(sw <= cw, `${viewport.width}x${viewport.height}: sideways scroll ${sw} > ${cw}`);
      assert.deepEqual(pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
