// FX-37 (D19): in the bulk "Calculating value" dialog a long skip message squeezed the use case name to one letter per line and grew the
// dialog past an 800 px window. The name keeps its width, the message wraps under it, and the dialog scrolls inside the viewport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { DEFAULTS, PLAN } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const LONG = `${'The model answered HTTP 400 and gave no plan for this use case so nothing was saved. '.repeat(3)}`.slice(0, 200);

function mount(app) {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/overall', (_req, res) => res.json({ at_stake: [], saved: [], runs: 0, businesses: 0 }));
  app.get('/api/inspire/value/runs', (_req, res) => res.json({ runs: {} }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (_req, res) => res.json({ run: { totals: [], n: 0, n_calculated: 0, n_estimated: 0, n_none: 0, by_verb: [] }, use_cases: {} }));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
  app.post('/api/inspire/value/case-plan', (_req, res) => res.status(422).json({ error: LONG }));
  app.put('/api/inspire/value/answers', (_req, res) => res.json({ version: 1, yearly: null, disclaimer: 'x' }));
  void PLAN;
}

for (const [label, width] of [['1280x800', 1280], ['390x800', 390]]) {
  test(`D19 ${label}: a 200-char skip message keeps the name 120 px wide and the dialog inside the viewport`, async () => {
    const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
    const page = ui.page;
    try {
      await page.setViewportSize({ width, height: 800 });
      await page.getByRole('region', { name: 'Use case list' }).locator('[aria-expanded]').first().waitFor();
      await page.getByRole('checkbox', { name: 'Select Predict churn', exact: true }).check();
      await page.getByRole('button', { name: 'Calculate value for 1', exact: true }).click();
      const row = page.locator('[data-bulk-row][data-bulk-state="skipped"]').first();
      await row.waitFor();
      const name = await row.locator('span').first().boundingBox();
      assert.ok(name.width >= 120, `name box is ${name.width}px wide`);
      const dialog = await page.getByRole('dialog').boundingBox();
      assert.ok(dialog.height <= 800, `dialog is ${dialog.height}px tall`);
      assert.ok(dialog.y >= 0 && dialog.y + dialog.height <= 800, 'dialog sits inside the viewport');
    } finally {
      await ui.close?.();
    }
  });
}
