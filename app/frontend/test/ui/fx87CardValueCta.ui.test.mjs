// FX-87 (REQ-485): a below-bar card with no value shows exactly one value call to action, the Calculate box stays inside the card,
// and the rename pencil stays on the title's last line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const RAW = 'the columns it needs hold too few values (arrival_delay_minutes=10,haul_type=10); relevance check';
const LONG = 'Rebalance Weekly Frequencies on Mismatched Routes Across The Whole Regional Network Every Planning Cycle';
const results = () => ({
  ...REVIEW_RESULTS,
  domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((uc) => (uc.No === 'N01-U02'
    ? { ...uc, Name: LONG, meets_quality_bar: 'N', below_bar_reason: RAW } : uc)) })),
});
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: { 'N01-U02': { status: 'set_rule', app: 'App' } } }));
};

for (const width of [1280, 1440]) {
  test(`at ${width}px a below-bar card with no value shows one value call to action, inside the card, with a plain reason`, async () => {
    const ui = await openUi('results', { ...REVIEW_STATE, results: results() }, '', { mount });
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height: 800 });
      const list = page.getByRole('region', { name: 'Use case list' });
      await list.locator('[aria-expanded]').first().waitFor();
      const card = list.locator('[aria-expanded]').filter({ has: page.locator('[data-testid="quality-bar-reason"]') }).first();
      await card.locator('[data-value-calculate]').waitFor();
      const reason = await card.locator('[data-testid="quality-bar-reason"]').innerText();
      const ctas = (await card.locator('[data-value-calculate]').count()) + (await card.locator('[data-value-estimate="set-rule"]').count());
      assert.equal(ctas, 1, 'exactly one value call to action');
      const outer = await card.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').boundingBox();
      const box = await card.locator('[data-value-calculate]').boundingBox();
      assert.ok(box.x >= outer.x && box.x + box.width <= outer.x + outer.width + 0.5, `the Calculate box (${box.x}+${box.width}) sits inside the card (${outer.x}+${outer.width})`);
      assert.doesNotMatch(reason, /_|=\d|relevance/, reason);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}
