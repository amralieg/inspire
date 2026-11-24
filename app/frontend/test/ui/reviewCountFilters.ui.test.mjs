// D-uae-06 (REQ-305): the Review header counts the same use cases the list shows.
// B13 (REQ-189 family, REQ-305): each use case card with data filters shows a "Data Filters" block; a card without filters shows none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { openReader, closeReader } from './reviewRows.mjs';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const FILTERS = [{ column: 'transactionID', text: '≥ 1000500' }, { column: 'product', text: 'Tokyo Tidbits, Golden Gate Ginger' }];

// The use-case table rows of the session: a stale pass holds fewer rows than the run's list.
const row = (id, name, extra = {}) => ({ id, use_case: name, name_with_technique: name, primary_table: 'main.s.orders', tables_involved: 'main.s.orders', ...extra });
const tableRows = () => [
  row('N01-U01', 'Predict churn', { data_filters: FILTERS }),
  row('N01-U02', 'Score upsell', { data_filters: [] }),
];

// The card root of the use case with this name (the header button's closest rounded card).
const cardOf = (page, name) => page.locator('[aria-label$=" use case details"][aria-expanded]').filter({ hasText: name }).first()
  .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');

async function openReview(useCases) {
  const ui = await openUi('app', { ...REVIEW_STATE, results: REVIEW_RESULTS, useCases, history: [] }, '', { mount });
  const { page } = ui;
  await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
  await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { window.location.hash = '#/review/42'; });
  return ui;
}

test('D-uae-06: the Review header total is the number of use cases the list shows', async () => {
  const ui = await openReview(tableRows());
  const { page } = ui;
  try {
    // REQ-511 (D3): the Build next header ("of N use cases live") left Review; the run box's "Use cases" figure is the header total now.
    const box = page.locator('[data-run-box]');
    await box.waitFor({ timeout: 20000 });
    const cards = page.locator('[data-use-case-row]');
    await cards.first().waitFor({ timeout: 20000 });
    const shown = await cards.count();
    assert.ok(shown > tableRows().length, `the list holds more use cases (${shown}) than the stale table rows`);
    const text = (await box.innerText()).replace(/\s+/g, ' ');
    assert.match(text, new RegExp(`Use cases ${shown}\\b`, 'i'), `header "${text}" counts the ${shown} use cases of the list`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('B13: a card with data filters shows a Data Filters block listing each filter, and a card without filters shows none', async () => {
  const ui = await openReview(tableRows());
  const { page } = ui;
  try {
    const cards = page.locator('[data-use-case-row]');
    await cards.first().waitFor({ timeout: 20000 });
    // REQ-511: a row click opens the reader, which holds the full card (the block lives there).
    const churn = await openReader(page, cards.filter({ hasText: 'Predict churn' }).first());
    const block = churn.locator('[data-use-case-data-filters]');
    await block.waitFor({ timeout: 10000 });
    assert.equal(await block.getByRole('heading', { name: 'Data Filters', exact: true }).count(), 1, 'the block is titled Data Filters');
    const lines = (await block.locator('li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(lines, ['transactionID: ≥ 1000500', 'product: Tokyo Tidbits, Golden Gate Ginger']);
    await closeReader(page);
    const upsell = await openReader(page, cards.filter({ hasText: 'Score upsell' }).first());
    await upsell.locator('[data-use-case-text="statement"]').waitFor({ timeout: 10000 });
    assert.equal(await upsell.locator('[data-use-case-data-filters]').count(), 0, 'no filters, no block');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
