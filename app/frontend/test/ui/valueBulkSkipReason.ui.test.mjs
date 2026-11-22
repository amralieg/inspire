// FX-46 (REQ-448, 454, 456, 431; W17 D19, D20, D40): the bulk dialog row for a use case no model could plan. A long use case name stays on
// one line (ellipsis, full name in the title), the reason wraps under it and says what the person can do, the dialog stays inside the
// viewport, and closing it any way (Close, X, Escape) removes the overlay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { DEFAULTS } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const SHORT = 'Predict churn';
const LONG_NAME = 'Predict churn for every subscription tier across all regions before the renewal window closes';
const RESULTS = JSON.parse(JSON.stringify(REVIEW_RESULTS).split(SHORT).join(LONG_NAME));
const REASON = 'Inspire could not reach a model to plan this use case (The App cannot query the model databricks-claude-sonnet-5. Give the App\'s service principal Can query on that serving endpoint (or EXECUTE on its system.ai model service)), so it saves no estimate; open Calculate value to set the numbers.';

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
  app.post('/api/inspire/value/case-plan', (_req, res) => res.status(422).json({ error: REASON }));
  app.put('/api/inspire/value/answers', (_req, res) => res.json({ version: 1, yearly: null, disclaimer: 'x' }));
}

async function skippedRow(width) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: RESULTS }, '', { mount });
  const page = ui.page;
  await page.setViewportSize({ width, height: 800 });
  await page.getByRole('region', { name: 'Use case list' }).locator('[aria-expanded]').first().waitFor();
  await page.getByRole('checkbox', { name: `Select ${LONG_NAME}`, exact: true }).check();
  await page.getByRole('button', { name: 'Calculate value for 1', exact: true }).click();
  const row = page.locator('[data-bulk-row][data-bulk-state="skipped"]').first();
  await row.waitFor();
  return { ui, page, row };
}

for (const [label, width] of [['1280x800', 1280], ['390x800', 390]]) {
  test(`FX-46 ${label}: a long name stays on one line with the full name as its title, and the dialog fits`, async () => {
    const { ui, page, row } = await skippedRow(width);
    try {
      const name = row.locator('[data-bulk-name]');
      assert.equal(await name.count(), 1, 'the name has its own marked element');
      assert.equal(await name.getAttribute('title'), LONG_NAME);
      const box = await name.boundingBox();
      assert.ok(box.height <= 28, `the name is ${box.height}px tall (one line)`);
      const reason = await row.locator('[data-bulk-reason]').boundingBox();
      assert.ok(reason.y >= box.y + box.height - 1, 'the reason sits under the name');
      const dialog = await page.getByRole('dialog').boundingBox();
      assert.ok(dialog.height <= 800, `dialog is ${dialog.height}px tall`);
      assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width, 'dialog sits inside the viewport width');
      const cut = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(cut <= 0, `the row is cut by ${cut}px on the right`);
    } finally { await ui.close?.(); }
  });
}

for (const how of ['Close', 'X', 'Escape']) {
  test(`FX-46 D40: ${how} removes the dialog and its overlay`, async () => {
    const { ui, page } = await skippedRow(1280);
    try {
      const dialog = page.getByRole('dialog');
      if (how === 'Escape') await page.keyboard.press('Escape');
      else if (how === 'X') await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      else await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
      await dialog.waitFor({ state: 'detached' });
      const blocking = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.position === 'fixed' && r.width >= innerWidth && r.height >= innerHeight && s.pointerEvents !== 'none';
      }).length);
      assert.equal(blocking, 0, 'no full-screen overlay is left');
    } finally { await ui.close?.(); }
  });
}
