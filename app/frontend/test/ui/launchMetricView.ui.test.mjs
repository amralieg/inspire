import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { START_DRAFT_PREFIX } from '../../src/lib/wizardDraft.js';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const VIEW = 'main.s.customer_value_metrics';
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customer_value_metrics'] },
  columnsByTable: { 'main.s.orders': [{ column_name: 'brand_name', data_type: 'STRING', ordinal_position: 1 }] },
  metricViews: [VIEW],
};

async function reloaded(page) {
  await page.reload();
  await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
  await idle(page);
}

test('a saved Data Filters pick that is a metric view is dropped from the scope on load, with a note, and the run carries no scope for it (REQ-128)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await idle(page);
    // The saved pick: the metric view in the basket, with a scope entry the Launch page would restore from the draft.
    await page.evaluate(([prefix, view]) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith(prefix));
      const saved = JSON.parse(localStorage.getItem(key));
      saved.spec.selectedCatalogs = ['main'];
      saved.spec.selectedSchemas = ['main.s'];
      saved.spec.selectedTables = [view];
      saved.spec.tableScopes = { [view]: { columns: ['brand_name'], rows: [] } };
      localStorage.setItem(key, JSON.stringify(saved));
    }, [START_DRAFT_PREFIX, VIEW]);
    await reloaded(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Filters \(optional\)/ }).click();
    const note = page.locator('[data-metric-view-note]');
    await note.waitFor({ timeout: 15000 });
    assert.match(await note.innerText(), /customer_value_metrics is a metric view, so Inspire leaves it out of Data Filters; pick its source table instead/);
    await idle(page);
    const block = await page.locator('#launch-block').count() ? await page.locator('#launch-block').innerText() : '';
    assert.equal(block, '', `Get Started is blocked by: ${block}`);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    const params = made.launches[0].params;
    assert.equal('17_table_scope' in params, false, 'the metric view has no scope in the run');
  } finally {
    await ui.close();
  }
});
