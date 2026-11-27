// FX-63c items 1 and 5 (REQ-481, D-uae-06): Results Build next counts what the list shows, and the value footer appears only with a calculated value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi, totalsQueryMissing, until } from './uiSupport.mjs';
import { openReader } from './reviewRows.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const FULL = JSON.parse(readFileSync(new URL('../../../backend/lib/valueDisclaimer.json', import.meta.url), 'utf8')).full;
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const RUN_VALUE = { totals: [{ currency: 'USD', amount: 120000, calculated: 120000, estimated: 0 }], n: 1, n_calculated: 1, n_estimated: 0, n_measured: 0, n_none: 0, n_shared: 0 };
const NO_VALUE = { totals: [], n: 0, n_calculated: 0, n_estimated: 0, n_measured: 0, n_none: 0, n_shared: 0 };
const mountWith = (runValue) => (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json({ run: { ...runValue, excluded: [], by_verb: [] }, use_cases: {}, run_value: runValue }));
};

test('Results with a calculated run total shows the footer text from the one disclaimer source', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountWith(RUN_VALUE) });
  try {
    // REQ-576: the one disclaimer moved from the footer to the top of the page.
    const footer = ui.page.locator('[data-value-disclaimer]');
    await footer.waitFor({ timeout: 15000 });
    assert.equal((await footer.innerText()).trim(), FULL);
  } finally { await ui.close(); }
});

test('Results with no value at all shows no footer', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountWith(NO_VALUE) });
  try {
    await ui.page.getByRole('region', { name: 'Use case list' }).waitFor({ timeout: 15000 });
    await ui.page.waitForTimeout(800);
    assert.equal(await ui.page.locator('[data-value-disclaimer], [data-value-footer]').count(), 0);
  } finally { await ui.close(); }
});

// REQ-511 D3: Build next left Review. What stays is that archiving takes the use case out of the shown list.
const shownOf = (page) => page.locator('[data-use-case-row]').count();

test('archiving a use case takes it out of the shown list; Review has no Build next panel (REQ-511 D3)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountWith(NO_VALUE) });
  const { page } = ui;
  try {
    await page.locator('[data-run-box]').waitFor({ timeout: 20000 });
    await page.locator('[data-use-case-row]').first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-build-next]').count(), 0, 'Review has no Build next panel');
    assert.equal(await page.locator('[data-build-next-row]').count(), 0, 'Review has no Build next rows');
    const before = await shownOf(page);
    const target = await page.locator('[data-use-case-row]').first().getAttribute('data-use-case-no');
    assert.ok(target, 'the list shows at least one use case');
    // Archive is a button of the card in the reader.
    const reader = await openReader(page, page.locator(`[data-use-case-row][data-use-case-no="${target}"]`));
    await reader.getByRole('button', { name: 'Archive use case' }).click();
    await until(async () => (await shownOf(page)) === before - 1);
    // REQ-511 (R1e): the run box counts ACTIVE use cases only; the archived one is on the Archived tab.
    const runBoxCount = async (label) => (await page.locator('[data-run-box] dt', { hasText: label }).locator('xpath=following-sibling::dd').innerText()).trim();
    assert.equal(await runBoxCount('Use cases'), String(before - 1), 'the run box Use cases counts active use cases only');
    assert.match(await runBoxCount('Value calculated'), new RegExp(` of ${before - 1}$`), 'Value calculated n of N uses the active N');
  } finally { await ui.close(); }
});
