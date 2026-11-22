// FX-63c items 1 and 5 (REQ-481, D-uae-06): Results Build next counts what the list shows, and the value footer appears only with a calculated value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi, totalsQueryMissing, until } from './uiSupport.mjs';
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
    const footer = ui.page.locator('[data-value-footer]');
    await footer.waitFor({ timeout: 15000 });
    assert.equal((await footer.innerText()).trim(), FULL);
  } finally { await ui.close(); }
});

test('Results with no value at all shows no footer', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountWith(NO_VALUE) });
  try {
    await ui.page.getByRole('region', { name: 'Use case list' }).waitFor({ timeout: 15000 });
    await ui.page.waitForTimeout(800);
    assert.equal(await ui.page.locator('[data-value-footer]').count(), 0);
  } finally { await ui.close(); }
});

const rowsOf = (page) => page.locator('[data-build-next-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-build-next-row')));
const totalOf = async (page) => Number(/of (\d+) use cases live/.exec(await page.locator('[data-build-progress]').innerText())?.[1]);

test('archiving a use case takes it out of Build next: the suggestions and the header count follow the shown list', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountWith(NO_VALUE) });
  const { page } = ui;
  try {
    const panel = page.locator('[data-build-next]');
    await panel.waitFor({ timeout: 20000 });
    const rows = await rowsOf(page);
    const before = await totalOf(page);
    const target = rows[0];
    assert.ok(target, 'the panel suggests at least one use case');
    await page.locator(`[data-use-case-no="${target}"]`).getByRole('button', { name: 'Archive use case' }).click();
    await until(async () => !(await rowsOf(page)).includes(target));
    await until(async () => (await totalOf(page)) === before - 1);
  } finally { await ui.close(); }
});
