// REQ-481 (FX-76), REQ-576: a page that shows a calculated dollar amount carries the full disclaimer once, at the top; a page without one does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const { full: FULL, short: SHORT } = JSON.parse(readFileSync(new URL('../../../backend/lib/valueDisclaimer.json', import.meta.url), 'utf8'));
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const RUN_VALUE = { totals: [{ currency: 'USD', amount: 120000, calculated: 120000, estimated: 0 }], n: 1, n_calculated: 1, n_estimated: 0, n_measured: 0, n_none: 0, n_shared: 0 };
const EMPTY = { totals: [], n: 1, n_calculated: 0, n_estimated: 0, n_measured: 0, n_none: 1, n_shared: 0 };
const base = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const UC = { status: 'calculated', amount: 3100000, currency: 'USD', verb: 'Value at stake' };

test('Choose: with a calculated run value the top disclaimer carries the full text; with none it is absent', async () => {
  for (const [value, expected] of [[RUN_VALUE, true], [EMPTY, false]]) {
    const mount = (app) => {
      base(app);
      app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json({ runs: [{ session_id: '42', name: 'Acme', ...value, run_value: value }], all: value, truncated: false, cap: 20 }));
    };
    const ui = await openUi('app', { ...REVIEW_STATE }, '', { mount });
    try {
      await ui.page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
      await ui.page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
      await ui.page.waitForTimeout(500);
      // REQ-576: one node at the top instead of the footer (data-value-footer is gone).
      assert.equal(await ui.page.locator('[data-value-disclaimer], [data-value-footer]').count(), expected ? 1 : 0);
      if (expected) assert.equal((await ui.page.locator('[data-value-disclaimer]').innerText()).trim(), FULL);
    } finally { await ui.close(); }
  }
});

test('Build: a valued use case page shows the full disclaimer once, above the amount, and no short label (REQ-576)', async () => {
  const mount = (app) => {
    base(app);
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: { 'N01-U01': { status: 'set_rule' } } }));
    app.get('/api/inspire/value/totals', (_req, res) => res.json({ run: { ...RUN_VALUE, by_verb: [] }, use_cases: { 'N01-U01': UC } }));
  };
  const ui = await openUi('app', { ...REVIEW_STATE, history: [] }, '', { mount });
  try {
    await ui.page.waitForLoadState('networkidle');
    await ui.page.waitForFunction(() => !document.body.innerText.includes('Connecting to workspace'), null, { timeout: 20000 });
    await ui.page.evaluate(() => { window.location.hash = '#/build/42/N01-U01'; });
    await ui.page.locator('[data-value-line-amount]').first().waitFor({ timeout: 20000 });
    const page = ui.page.locator('[data-implement-page]');
    assert.equal(await page.locator('[data-value-disclaimer], [data-value-footer]').count(), 1, 'one disclaimer node on the page');
    assert.equal((await page.locator('[data-value-disclaimer]').innerText()).trim(), FULL);
    assert.ok(!(await page.innerText()).includes(SHORT), 'no short label by the amount');
    assert.ok((await page.locator('[data-value-disclaimer]').boundingBox()).y < (await page.locator('[data-value-line-amount]').first().boundingBox()).y, 'the disclaimer sits above the first amount');
  } finally { await ui.close(); }
});

test('Launch has no dollar amount, so no footer', async () => {
  const ui = await openUi('launch', {});
  try {
    await ui.page.waitForTimeout(1000);
    assert.equal(await ui.page.locator('[data-value-footer]').count(), 0);
  } finally { await ui.close(); }
});
