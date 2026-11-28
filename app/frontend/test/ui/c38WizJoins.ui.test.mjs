// REQ-584 (U9): the wizard suggests joins across the tables the person picked, pre-filled and removable, with "Add a join".
// The launch carries a removed suggestion as removed:true and an added join plain. Neutral names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { WIZ_TITLE } from '../../src/lib/startWizard.js';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const next = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true });
const side = (table, column) => ({ table: `main.s.${table}`, column });
const SUGGESTED = [
  { from: side('orders', 'customer_id'), to: side('customers', 'customer_id'), source: 'matching column name' },
  { from: side('refunds', 'order_id'), to: side('orders', 'order_id'), source: 'matching column name' },
  { from: side('refunds', 'customer_id'), to: side('customers', 'customer_id'), source: 'matching column name' },
];
const COLUMNS = {
  'main.s.orders': ['order_id', 'customer_id', 'amount'],
  'main.s.customers': ['customer_id', 'name'],
  'main.s.refunds': ['refund_id', 'order_id', 'customer_id'],
};
const STATE = {
  sessions: [], portfolioRuns: [{ runs: '0', businesses: '0' }], portfolioUseCases: [], portfolioMvps: [],
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers', 'refunds'] },
  columnsByTable: Object.fromEntries(Object.entries(COLUMNS).map(([t, cols]) => [t, cols.map((c, i) => ({ column_name: c, data_type: 'BIGINT', ordinal_position: i + 1 }))])),
  statements: {}, primaryKeys: [],
};

test('REQ-584: three picked tables show suggested joins; one removed, one added; the review names them and the launch carries both', async () => {
  const asked = [];
  const mount = (app) => app.post('/api/relationships', (req, res) => {
    asked.push(req.body);
    if (req.body.table) {
      return res.json({ tables: Object.fromEntries(Object.entries(COLUMNS).map(([t, columns]) => [t, { columns }])), suggestions: [], metric_views: [] });
    }
    return res.json({ suggestions: SUGGESTED, labels: {}, metric_views: [] });
  });
  const ui = await openUi('choose', STATE, '', { mount });
  const { page, made } = ui;
  try {
    await page.locator('[data-start-new]').first().click();
    const dialog = page.getByRole('dialog', { name: WIZ_TITLE });
    await dialog.waitFor({ timeout: 15000 });
    await dialog.locator('[data-wiz-path="discover"]').click();
    await next(dialog).click();
    await dialog.locator('[data-wiz-step="business"]').getByPlaceholder(BUSINESS).fill('Example Co');
    await next(dialog).click();
    const data = dialog.locator('[data-wiz-step="data"]');
    await data.locator('[data-wiz-data-choice="choose"]').click();
    await data.locator('button[title="main"]').click();
    await data.locator('button[title="s"]').click();
    for (const t of ['orders', 'customers', 'refunds']) await data.locator(`button[title="${t}"]`).click();
    await idle(page);

    const joins = dialog.locator('[data-wiz-joins]');
    await joins.waitFor({ timeout: 15000 });
    await until(async () => (await joins.locator('[data-wiz-join]').count()) === 3, 'three suggested joins show', 15000);
    assert.deepEqual([...asked.filter((b) => !b.table).at(-1).tables].sort(), Object.keys(COLUMNS).sort(), 'the last call asks about all three tables');

    // Remove one by keyboard (Enter on its button).
    const gone = 'refunds.customer_id → customers.customer_id';
    const removeButton = joins.getByRole('button', { name: `Remove join ${gone}` });
    await removeButton.focus();
    await page.keyboard.press('Enter');
    await until(async () => (await joins.locator('[data-wiz-join]').count()) === 2, 'the removed join leaves the list');
    assert.equal(await joins.locator(`[data-wiz-join-removed="${gone}"]`).count(), 1, 'a removed join stays listed, with Restore');

    // Add one by click: refunds.customer_id -> orders.customer_id (not suggested).
    await joins.locator('[data-wiz-join-add]').click();
    await joins.locator('[data-list="source"]').getByRole('button', { name: 'refunds', exact: true }).click();
    await joins.locator('[data-list="target"]').getByRole('button', { name: 'orders', exact: true }).click();
    await joins.locator('[data-link-open]').click();
    const link = page.getByRole('dialog', { name: 'Link refunds to orders' });
    await link.locator('ul[aria-label="Columns of refunds"]').getByRole('button', { name: 'customer_id', exact: true }).click();
    await link.locator('ul[aria-label="Columns of orders"]').getByRole('button', { name: 'customer_id', exact: true }).click();
    await link.getByRole('button', { name: 'Link', exact: true }).click();
    await link.getByRole('button', { name: 'Close', exact: true }).click();
    await joins.locator('[data-wiz-join-add]').click();
    await until(async () => (await joins.locator('[data-wiz-join]').count()) === 3, 'the added join is listed');

    await next(dialog).click();
    await next(dialog).click();
    await next(dialog).click();
    const review = dialog.locator('[data-wiz-step="review"]');
    await review.waitFor();
    const text = await review.innerText();
    assert.match(text, /orders\.customer_id → customers\.customer_id/, 'the review names a join kept');
    assert.match(text, /refunds\.customer_id → orders\.customer_id/, 'the review names the join added');
    assert.match(text, /1 removed/);

    await dialog.locator('[data-wiz-start]').click();
    await until(() => made.launches.length === 1, 'one run was sent', 20000);
    const sent = JSON.parse(made.launches[0].params['18_table_relationships']);
    const name = (j) => `${j.from.table}.${j.from.column}>${j.to.table}.${j.to.column}`;
    const removed = sent.filter((j) => j.removed === true).map(name);
    assert.deepEqual(removed, ['main.s.refunds.customer_id>main.s.customers.customer_id'], 'the removed suggestion is sent as removed:true');
    const plain = sent.filter((j) => !('removed' in j)).map(name).sort();
    assert.deepEqual(plain, ['main.s.orders.customer_id>main.s.customers.customer_id', 'main.s.refunds.customer_id>main.s.orders.customer_id', 'main.s.refunds.order_id>main.s.orders.order_id'].sort(),
      'kept suggestions and the added join go out plain');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
