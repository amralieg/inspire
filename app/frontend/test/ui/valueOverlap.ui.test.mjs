// REQ-454 + REQ-448: the run panel says which values are shared, which are flagged and not counted, and what the total leaves out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const REASON = 'Check the numbers: $638.96M a year is above $100M, the top of the usual range for one use case. Most of it is Risk avoided ($547.5M).';
const TOTALS = {
  run: { totals: [{ currency: 'USD', amount: 3561000, calculated: 1000000, estimated: 2561000 }], n: 4, n_calculated: 1, n_estimated: 3, n_none: 0,
    n_shared: 1, excluded: [{ currency: 'USD', amount: 638960000, n: 1 }], by_verb: [{ currency: 'USD', verb: 'AVOID RISK', amount: 3561000 }] },
  use_cases: {
    'N01-U01': { status: 'calculated', verb: 'AVOID RISK', amount: 1000000, currency: 'USD', overlap: { counted: true, shared_with: ['N01-U02'] } },
    'N01-U02': { status: 'estimated', verb: 'AVOID RISK', amount: 1000000, currency: 'USD', overlap: { counted: false, with: 'N01-U01', not_counted: 1000000 } },
    'N01-U03': { status: 'estimated', verb: 'REDUCE COST', amount: 2561000, currency: 'USD' },
    'N01-U04': { status: 'estimated', verb: 'AVOID RISK', amount: 638960000, currency: 'USD', counted: false, check: { outside: 'high', reason: REASON } },
  },
};
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
};
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

test('the run panel marks shared values, flagged values and what the total leaves out', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  try {
    const list = ui.page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor();
    await toView(ui.page, 'Business');
    const panel = ui.page.locator('[data-value-run-panel]');
    await panel.waitFor({ timeout: 15000 });
    assert.match(await text(panel.locator('tr[data-value-row="N01-U02"]')), /Shared with Predict churn, counted once/);
    assert.match(await text(panel.locator('tr[data-value-row="N01-U01"]')), /Also counted for 1 other use case/);
    const flagged = panel.locator('tr[data-value-row="N01-U04"]');
    assert.match(await text(flagged), /Check the numbers/);
    assert.match(await text(flagged), /not counted/);
    assert.equal(await flagged.getByText('Check the numbers').first().getAttribute('title'), REASON);
    assert.match(await text(panel), /1 estimate outside \$100K to \$100M not counted/);
    assert.match(await text(panel), /1 shared value counted once/);
    assert.equal(await text(panel.locator('[data-value-run-total]')), 'Run total $3.56M');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
