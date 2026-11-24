import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

// FX-34b (REQ-078, REQ-096, REQ-451): the one run value shows the total at stake, what was saved, the non-money kinds, and "from N MVPs"
// on the Start banner, the run card and the Review header, and the three say the same.
const RUN_VALUE = {
  totals: [{ currency: 'AED', amount: 12000, calculated: 9000, estimated: 3000 }], n: 2, n_calculated: 1, n_estimated: 1, n_measured: 0, n_none: 0, n_shared: 0,
  saved: [{ kind: 'money', unit: 'AED', amount: 1500 }], kinds: [{ kind: 'time', unit: 'hours', amount: 120 }], n_mvps: 2,
};
const TOTALS_ONE = { run: { ...RUN_VALUE, excluded: [], by_verb: [] }, use_cases: {}, run_value: RUN_VALUE };
const TOTALS_ALL = { runs: [{ session_id: '42', name: 'Acme', ...RUN_VALUE, run_value: RUN_VALUE }], all: RUN_VALUE, truncated: false, cap: 20 };
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(req.query.session_id ? TOTALS_ONE : TOTALS_ALL));
};

// What a surface says about the run: the saved headline, the chips, and the MVP count.
const readOf = async (root) => ({
  saved: (await root.locator('[data-value-headline="saved"]').first().innerText()).trim(),
  chips: await root.locator('[data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim())),
  mvps: (await root.locator('[data-value-mvps]').first().innerText()).trim(),
});
const WANT = { saved: 'AED 1.5K', chips: ['120 hours'], mvps: 'from 2 MVPs' };

test('Start: the banner and the run card show the total, saved, the hours chip and from 2 MVPs, equal', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE }, '', { mount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const card = page.locator('[data-run="42"] [data-run-value]');
    await card.locator('[data-run-value-total]').waitFor({ timeout: 20000 });
    const banner = page.locator('[data-value-overall]');
    await banner.waitFor({ timeout: 15000 });
    assert.equal((await banner.locator('[data-total-amount]').first().innerText()).trim(), 'AED 12K');
    assert.equal((await card.locator('[data-run-value-total]').innerText()).trim(), 'AED 12K');
    const fromBanner = await readOf(banner.locator('[data-value-kinds]').first());
    const fromCard = await readOf(card);
    assert.deepEqual(fromBanner, WANT);
    assert.deepEqual(fromCard, fromBanner, 'the card says what the banner says');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Review: the header shows the total, saved, the hours chip and from 2 MVPs, equal to the Start card', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const header = page.locator('[data-run-box] [data-run-header-value]');
    await header.locator('[data-run-value-total]').waitFor({ timeout: 15000 });
    assert.equal((await header.locator('[data-run-value-total]').innerText()).trim(), 'AED 12K');
    assert.deepEqual(await readOf(header), WANT);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
