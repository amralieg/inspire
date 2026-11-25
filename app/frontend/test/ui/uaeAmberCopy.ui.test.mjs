// REQ-305 (D-uae-03): the Data Management search summary counts the distinct picked tables that match.
// REQ-523: the REQ-444 refine-banner cases went with the score-refine feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const COL = (name, type, n) => ({ column_name: name, data_type: type, ordinal_position: n });
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers', 'segment_rollup'] },
  columnsByTable: {
    'main.s.orders': [COL('order_id', 'BIGINT', 1), COL('brand', 'STRING', 2)],
    'main.s.customers': [COL('customer_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('segment', 'STRING', 3)],
    'main.s.segment_rollup': [COL('segment', 'STRING', 1), COL('segment_id', 'BIGINT', 2), COL('customer_segment', 'STRING', 3)],
  },
  readinessRows: [{ row_count: '1200' }],
};

test('REQ-305: four matching columns in two of the three picked tables read "4 columns in 2 tables"', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await idle(page);
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    for (const t of ['orders', 'customers', 'segment_rollup']) await page.locator(`button[title="${t}"]`).click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.getByRole('searchbox', { name: 'Search column names' }).waitFor({ timeout: 15000 });
    await until(async () => (await page.locator('[data-search-hint]').count()) === 1, 'the search hint shows', 15000);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('segment');
    await page.locator('[data-column-hit="segment"]').first().waitFor({ timeout: 10000 });
    const text = (await page.locator('[data-column-search]').innerText()).replace(/\s+/g, ' ');
    assert.match(text, /4 columns in 2 tables/);
    assert.doesNotMatch(text, /in 4 tables/);
  } finally {
    await ui.close();
  }
});
