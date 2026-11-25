// Shared Review backend for the 2026-11-25 UI-ask specs (REQ-508, REQ-512): the scored REVIEW_STATE run with yearly totals,
// the same shape as req511Review.ui.test.mjs, so the sort, bulk and reader specs read one fixture.
import { openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

export const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
export const SCORES = { 'N01-U01': '7.4', 'N01-U02': '8.1', 'N01-U03': '5.2', 'N01-U04': '6.0', 'N02-U01': '9.0', 'N02-U02': '4.5' };
export const SCORED = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => ({ ...u, inspire_score: SCORES[u.No] })) })) };
const entry = (status, verb, amount) => (status === 'none' ? { status, verb: null, amount: null, currency: null } : { status, verb, amount, currency: 'USD' });
export const TOTALS = {
  run: { totals: [{ currency: 'USD', amount: 6700000, calculated: 3200000, estimated: 3500000 }], n: 6, n_calculated: 1, n_estimated: 2, n_none: 3,
    by_verb: [{ currency: 'USD', verb: 'AVOID RISK', amount: 3200000 }, { currency: 'USD', verb: 'GROW REVENUE', amount: 2400000 }, { currency: 'USD', verb: 'REDUCE COST', amount: 1100000 }] },
  use_cases: { 'N01-U01': entry('calculated', 'AVOID RISK', 3200000), 'N01-U02': entry('estimated', 'GROW REVENUE', 2400000),
    'N01-U03': entry('estimated', 'REDUCE COST', 1100000), 'N01-U04': entry('none'), 'N02-U01': entry('none'), 'N02-U02': entry('none') },
};

export function mountReview(app) {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
}

export async function openReview({ width = 1440, height = 900 } = {}) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: SCORED }, '', { mount: mountReview });
  await ui.page.setViewportSize({ width, height });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[data-use-case-row]').first().waitFor({ timeout: 15000 });
  const row = (no) => list.locator(`[data-use-case-row][data-use-case-no="${no}"]`);
  return { ui, page: ui.page, list, row };
}

// The row order, as use case numbers.
export const order = (list) => list.locator('[data-use-case-row]').evaluateAll((els) => els.map((e) => e.dataset.useCaseNo));
