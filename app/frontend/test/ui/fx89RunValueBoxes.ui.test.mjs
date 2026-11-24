// FX-89 (REQ-487, REQ-488, REQ-489): the Runs page all-runs panel is the number only; each run has a red box with its total ("$20M+" over 20M,
// "Not calculated" when none); no label reads as a cost ("Value of this run"); every value disclaimer has a warning icon before it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const value = (calculated, estimated) => ({ totals: [{ currency: 'USD', amount: calculated + estimated, calculated, estimated }], n: 3,
  n_calculated: calculated ? 1 : 0, n_estimated: estimated ? 1 : 0, n_measured: 0, n_none: 0, n_shared: 0 });
const NONE = { totals: [], n: 2, n_calculated: 0, n_estimated: 0, n_measured: 0, n_none: 2, n_shared: 0 };
const TOTALS = { runs: [
  { session_id: '42', name: 'Acme', ...value(3.1e6, 0), run_value: value(3.1e6, 0) },
  { session_id: '50', name: 'Beta Foods', ...value(0, 25e6), run_value: value(0, 25e6) },
  { session_id: '51', name: 'Gamma', ...NONE, run_value: NONE },
], all: value(3.1e6, 25e6), truncated: false, cap: 20 };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
};
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

test('the Runs page: number-only all-runs panel, a red value box on every run, no cost-like label, a warning icon before every disclaimer', async () => {
  const ui = await openUi('app', REVIEW_STATE, '', { mount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    // REQ-510: the all-runs value panel opens from the page More menu.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Value across all runs' }).click();
    const panel = page.locator('[data-value-all-panel]');
    await panel.locator('[data-total-amount]').first().waitFor({ timeout: 20000 });
    assert.equal(await panel.locator('table, tr, [data-all-runs-row]').count(), 0, 'REQ-487: no per-run table in the all-runs panel');
    for (const [sid, want] of [['42', '$3.1M'], ['50', '$20M+'], ['51', 'Not calculated']]) {
      const box = page.locator(`[data-run="${sid}"] [data-run-value-box]`);
      await box.waitFor({ timeout: 20000 });
      assert.ok((await text(box)).includes(want), `REQ-488: run ${sid} box shows ${want}, got "${await text(box)}"`);
      assert.match(await box.evaluate((el) => getComputedStyle(el).borderTopColor), /rgb\(\s*(19[0-9]|2[0-9]{2}),\s*\d{1,2},\s*\d{1,2}\)|rgb\(\s*\d+,\s*\d+,\s*\d+\)/);
      assert.ok(/border/.test(await box.getAttribute('class')) && /db-red|primary-solid/.test(await box.getAttribute('class')), 'REQ-488: red-themed border');
    }
    assert.ok(!/Value of this run/i.test(await page.locator('body').innerText()), 'REQ-489: "Value of this run" appears nowhere');
    assert.equal(await page.locator('[aria-label="Value of this run"]').count(), 0);
    const disclaimers = page.locator('[data-value-disclaimer]');
    const n = await disclaimers.count();
    assert.ok(n > 0, 'disclaimers are shown');
    for (let i = 0; i < n; i += 1) {
      const hasIcon = await disclaimers.nth(i).evaluate((el) => {
        const prev = el.previousElementSibling || el.querySelector('[aria-label="Warning"]');
        return Boolean(prev && (prev.matches('[aria-label="Warning"]') || prev.querySelector('[aria-label="Warning"]')));
      });
      assert.ok(hasIcon, `REQ-489: disclaimer ${i} has a warning icon before it`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
