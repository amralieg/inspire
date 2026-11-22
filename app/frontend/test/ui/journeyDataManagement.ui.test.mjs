import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-470: Data Management (Relationships, then Data filter) walked as a business user does: open, pick, link, launch, reload, undo,
// empty and error states, long names, and both screen sizes with no sideways scroll and no console error.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const COL = (name, type, n) => ({ column_name: name, data_type: type, ordinal_position: n });
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: {
    [ORDERS]: [COL('order_id', 'BIGINT', 1), COL('customer_id', 'BIGINT', 2), COL('brand', 'STRING', 3)],
    [CUSTOMERS]: [COL('customer_id', 'BIGINT', 1), COL('name', 'STRING', 2), COL('brand', 'STRING', 3)],
  },
  statements: { 'AS ref_table': () => ({ rows: [] }) },
  primaryKeys: [],
  readinessRows: [{ row_count: '1200' }],
};
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];
const source = (page, name) => page.locator('[data-list="source"]').getByRole('button', { name, exact: true });
const target = (page, name) => page.locator('[data-list="target"]').getByRole('button', { name, exact: true });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function pick(page, tables = ['orders', 'customers']) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  for (const t of tables) await page.locator(`button[title="${t}"]`).click();
  await idle(page);
}

async function openSection(page) {
  for (const name of [/Advanced Settings/, /Data Management \(optional\)/]) {
    const toggle = page.getByRole('button', { name });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }
  await page.locator('[data-data-management]').waitFor({ timeout: 15000 });
}

async function linkAmount(page, a = 'customer_id', b = 'customer_id') {
  await source(page, 'orders').click();
  await target(page, 'customers').click();
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  const dialog = page.locator('[data-link-dialog]');
  await dialog.getByRole('list', { name: 'Columns of orders' }).waitFor({ timeout: 15000 });
  await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: a, exact: true }).click();
  await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: b, exact: true }).click();
  await dialog.getByRole('button', { name: 'Link', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

const LINK = 'orders.customer_id → customers.customer_id';

test('Data Management opens and closes, keeps its two sections in order, and starts with no links and no filters', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await pick(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    const toggle = page.getByRole('button', { name: /Data Management \(optional\)/ });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'starts closed so the default page is unchanged');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await page.locator('[data-data-management] h3').allInnerTexts(), ['Relationships', 'Data filter']);
    assert.match(await page.locator('[data-links-empty]').innerText(), /No links yet/);
    assert.equal(await page.locator('[data-filters-in-use]').count(), 0);
    await toggle.click();
    assert.equal(await page.locator('[data-data-management]').count(), 0, 'closing hides the section');
    await toggle.click();
    assert.equal(await page.locator('[data-data-management]').count(), 1, 'it opens again');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('link journey: link two tables, the launch carries it, a reload keeps it, Remove clears it, and a launch then carries none', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await pick(page);
    await openSection(page);
    await linkAmount(page);
    await page.locator(`[data-relationship="${LINK}"]`).waitFor({ timeout: 5000 });
    assert.equal(await page.locator('[data-links]').getByText('Links (1)', { exact: true }).count(), 1);
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
    await openSection(page);
    await page.locator(`[data-relationship="${LINK}"]`).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: `Remove relationship ${LINK}` }).click();
    assert.match(await page.locator('[data-links-empty]').innerText(), /No links yet/);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByRole('button', { name: 'Run without saving' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.ok(!made.launches[0].params['18_table_relationships'], 'a removed link is not sent');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('link journey: the launch carries the link that was made', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made, pageErrors } = ui;
  try {
    await pick(page);
    await openSection(page);
    await linkAmount(page);
    await page.locator(`[data-relationship="${LINK}"]`).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByRole('button', { name: 'Run without saving' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    const sent = made.launches[0].params['18_table_relationships'];
    assert.ok(sent, 'the link is sent');
    assert.match(sent, /customer_id/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the same pair cannot be linked twice, in either direction, and the dialog says why', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await pick(page);
    await openSection(page);
    await linkAmount(page);
    await source(page, 'orders').click();
    await target(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.locator('[data-link-dialog]');
    await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: 'Link', exact: true }).isDisabled(), true);
    assert.match(await dialog.locator('[data-link-refused]').innerText(), /already linked on customer_id/);
    assert.equal(await page.locator('[data-relationship]').count(), 1);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

for (const [status, error] of [[500, 'The warehouse is not reachable right now.'], [400, 'These tables cannot be read.']]) {
  test(`error state: reading the columns for a link answering ${status} says so, the picks stay, and Try again recovers`, async () => {
    let fail = true;
    const mount = (app) => app.post('/api/relationships', (req, res, next) => (fail ? res.status(status).json({ error }) : next()));
    const ui = await openUi('launch', STATE, '', { mount });
    const { page } = ui;
    try {
      await pick(page);
      await openSection(page);
      await source(page, 'orders').click();
      await target(page, 'customers').click();
      await page.getByRole('button', { name: 'Link', exact: true }).click();
      const dialog = page.locator('[data-link-dialog]');
      const alert = dialog.locator('[role="alert"]');
      await alert.waitFor({ timeout: 10000 });
      assert.equal((await alert.innerText()).trim(), error);
      assert.equal(await dialog.getByRole('list', { name: 'Columns of orders' }).count(), 0, 'no column list beside the error');
      fail = false;
      await dialog.getByRole('button', { name: 'Try again' }).click();
      await dialog.getByRole('list', { name: 'Columns of orders' }).waitFor({ timeout: 10000 });
      assert.equal(await dialog.locator('[role="alert"]').count(), 0);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await source(page, 'orders').getAttribute('aria-pressed'), 'true', 'the source pick stays');
    } finally {
      await ui.close();
    }
  });
}

test('empty state: with no table picked the Relationships section says what to do and offers no Link', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await idle(page);
    await openSection(page);
    assert.match(await page.locator('[data-relationships-empty]').innerText(), /Pick tables under Unity Catalog Metadata/);
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).count(), 0);
    assert.match(await page.locator('[data-data-filters-empty]').innerText(), /Pick tables above/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('one picked table: Link stays disabled with its reason, since a table cannot be linked to itself', async () => {
  const ui = await openUi('launch', STATE);
  const { page, pageErrors } = ui;
  try {
    await pick(page, ['orders']);
    await openSection(page);
    await source(page, 'orders').click();
    assert.equal(await target(page, 'orders').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), true);
    assert.match(await page.locator('[data-link-reason]').innerText(), /Pick one source table and one target table/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('long table and column names stay inside Data Management with a link and a filter at both screen sizes', async () => {
  const a = `orders_${'x'.repeat(80)}`;
  const b = `customers_${'z'.repeat(80)}`;
  const colA = `customer_reference_${'k'.repeat(70)}`;
  const state = {
    ...STATE,
    tables: { 'main.s': [a, b] },
    columnsByTable: { [`main.s.${a}`]: [COL(colA, 'STRING', 1)], [`main.s.${b}`]: [COL(colA, 'STRING', 1)] },
  };
  for (const viewport of VIEWPORTS) {
    const ui = await openUi('launch', state);
    const { page, pageErrors } = ui;
    try {
      await page.setViewportSize(viewport);
      await pick(page, [a, b]);
      await openSection(page);
      await page.locator('[data-list="source"]').getByRole('button', { name: a, exact: true }).click();
      await page.locator('[data-list="target"]').getByRole('button', { name: b, exact: true }).click();
      await page.getByRole('button', { name: 'Link', exact: true }).click();
      const dialog = page.locator('[data-link-dialog]');
      await dialog.getByRole('list', { name: `Columns of ${a}` }).waitFor({ timeout: 15000 });
      await dialog.getByRole('list', { name: `Columns of ${a}` }).getByRole('button', { name: colA, exact: true }).click();
      await dialog.getByRole('list', { name: `Columns of ${b}` }).getByRole('button', { name: colA, exact: true }).click();
      await dialog.getByRole('button', { name: 'Link', exact: true }).click();
      assert.ok((await sideways(page)) <= 0, `${viewport.width}x${viewport.height}: dialog with long names scrolls sideways`);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search column names' }).fill('customer_reference');
      await page.locator(`[data-column-hit="${colA}"]`).first().waitFor({ timeout: 10000 });
      const over = await page.locator('[data-data-management]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [...el.querySelectorAll('*')].filter((c) => c.getBoundingClientRect().right > r.right + 1 && getComputedStyle(c).display !== 'none'
          && !c.closest('ul[aria-label], [aria-label^="Columns"]')).map((c) => `${c.tagName}:${(c.textContent || '').slice(0, 30)}`);
      });
      assert.deepEqual(over, [], `${viewport.width}: nothing runs past the section edge`);
      assert.ok((await sideways(page)) <= 0, `${viewport.width}x${viewport.height}: page scrolls sideways`);
      assert.deepEqual(pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('metric views left out: one line, Show them opens the names, and Show it hides nothing else; no sideways scroll at both sizes', async () => {
  for (const viewport of VIEWPORTS) {
    const ui = await openUi('launch', { ...STATE, tables: { 'main.s': [...Array.from({ length: 550 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`), 'mv_one'] }, metricViews: ['main.s.mv_one'] });
    const { page, pageErrors } = ui;
    try {
      await page.setViewportSize(viewport);
      await pick(page, []);
      await openSection(page);
      const line = page.locator('[data-metric-views-left-out]');
      await line.waitFor({ timeout: 15000 });
      assert.match(await line.locator('p').innerText(), /^1 metric view is left out of Data Management: it cannot be filtered\./);
      await line.getByRole('button', { name: 'Show it' }).click();
      assert.equal(await page.locator('[data-list="source"] button').filter({ hasText: 'mv_one' }).count(), 0, 'the metric view is not offered to link');
      assert.deepEqual(await page.locator('[data-metric-views-names] li').allInnerTexts(), ['main.s.mv_one']);
      assert.equal(await line.getByRole('button', { name: 'Show it' }).getAttribute('aria-expanded'), 'true');
      await line.getByRole('button', { name: 'Show it' }).click();
      assert.equal(await page.locator('[data-metric-views-names]').count(), 0, 'the names fold away again');
      assert.ok((await sideways(page)) <= 0, `${viewport.width}x${viewport.height} scrolls sideways`);
      assert.deepEqual(pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
