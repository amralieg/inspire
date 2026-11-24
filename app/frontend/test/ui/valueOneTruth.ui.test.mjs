// FX-34 (REQ-448, REQ-454; W16 D1/D2/D3/D7/D8/D9): one run value on every surface. The Start bars, the Start panel, the run card,
// the Review header and the Business panel show the same total; the Business rows add up to it; a label that does not fit moves to a tooltip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
// Run 42: one calculated ($6.8M), one estimated ($2.4M), one estimated that shares the first estimate's pool (adds 0), one not estimated.
const TOTALS = [{ currency: 'USD', amount: 9200000, calculated: 6800000, estimated: 2400000 }];
const RUN_VALUE = { totals: TOTALS, n: 4, n_calculated: 1, n_estimated: 2, n_measured: 0, n_none: 1, n_shared: 1 };
const RUN = { ...RUN_VALUE, excluded: [], by_verb: [{ currency: 'USD', verb: 'AVOID RISK', amount: 9100000 }, { currency: 'USD', verb: 'REDUCE COST', amount: 100000 }] };
const USE_CASES = {
  'N01-U01': { status: 'calculated', verb: 'AVOID RISK', amount: 6800000, currency: 'USD', counted_amount: 6800000 },
  'N01-U02': { status: 'estimated', verb: 'AVOID RISK', amount: 2300000, currency: 'USD', counted_amount: 2300000, overlap: { counted: true, shared_with: ['N01-U03'] } },
  'N01-U03': { status: 'estimated', verb: 'AVOID RISK', amount: 2300000, currency: 'USD', counted_amount: 0, overlap: { counted: false, with: 'N01-U02', not_counted: 2300000 } },
  'N01-U04': { status: 'estimated', verb: 'REDUCE COST', amount: 100000, currency: 'USD', counted_amount: 100000 },
  'N02-U01': { status: 'not_estimated', stale: true, verb: '', amount: null, currency: '', reason: 'This estimate was saved before Inspire planned each use case on its own data: calculate it again.' },
};
const ALL = { runs: [{ session_id: '42', name: 'Acme', created_at: '2026-11-21 10:00:00', ...RUN_VALUE, run_value: RUN_VALUE }], all: RUN_VALUE, truncated: false, cap: 20 };
const LEDGER_RUN = { use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json(LEDGER_RUN));
  app.get('/api/inspire/value/estimates', (req, res) => res.json(req.query.session_id ? { use_cases: {}, totals: null, run_value: RUN_VALUE } : { runs: {}, totals: { estimated: {} }, run_value: RUN_VALUE }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(req.query.session_id ? { run: RUN, use_cases: USE_CASES, run_value: RUN_VALUE } : ALL));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
};
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const money = (t) => {
  const m = /\$([\d.,]+)([KMB]?)/.exec(t);
  return m ? Number(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1) : NaN;
};

test('2a: the Start bars, the Start panel, the run card, the Review header and the Business panel show the same run total', async () => {
  const start = await openUi('app', REVIEW_STATE, '', { mount });
  try {
    const { page } = start;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    // REQ-510 L2: the all-runs value panel opens from the Start More menu.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Value across all runs' }).click();
    const panelTotal = page.locator('[data-value-all-panel] [data-total-amount]').first();
    await panelTotal.waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-value-all-panel] [data-all-runs-row]').count(), 0, 'no per-run table in the all-runs panel');
    assert.equal(await text(page.locator('[data-value-all-panel] [data-total-amount]').first()), '$9.2M', 'Start panel');
    const card = page.locator('[data-run="42"] [data-run-value] [data-run-value-total]');
    await card.waitFor({ timeout: 20000 });
    assert.equal(await text(card), '$9.2M', 'the run card says the run value, not Not calculated');
    const body = await text(page.locator('main'));
    assert.ok(!/none saved yet|none yet/i.test(body), 'no second value panel that says none yet');
    assert.equal(await page.getByRole('region', { name: 'Value across runs' }).count(), 1, 'one value panel on Start');
    assert.deepEqual(start.pageErrors, []);
  } finally { await start.close(); }

  const review = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  try {
    const { page } = review;
    const header = page.locator('[data-run-header-value] [data-run-value-total]');
    await header.waitFor({ timeout: 20000 });
    assert.equal(await text(header), '$9.2M', 'Review header');
    assert.equal(await page.getByText('Not measured yet').count(), 0, 'the header never says Not measured yet beside a run value');
    await toView(page, 'Business');
    const panel = page.locator('[data-value-run-panel]');
    await panel.waitFor({ timeout: 15000 });
    assert.equal(await text(panel.locator('[data-total-amount]').first()), '$9.2M', 'Business panel');
    assert.deepEqual(review.pageErrors, []);
  } finally { await review.close(); }
});

test('2b: the Business rows show counted-in amounts that sum to the run total, and the bar shows both shares', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  try {
    const { page } = ui;
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
    await toView(page, 'Business');
    const panel = page.locator('[data-value-run-panel]');
    await panel.waitFor({ timeout: 15000 });
    const counted = await panel.locator('[data-value-row] [data-value-counted]').allInnerTexts();
    assert.equal(counted.length, 4, `four rows with a value show a counted-in amount: ${counted.join(' | ')}`);
    const sum = counted.reduce((s, t) => s + (money(t) || 0), 0);
    assert.equal(Math.round(sum), 9200000, `visible parts ${counted.join(' + ')} add up to the total`);
    assert.match(await text(panel.locator('[data-value-row="N01-U03"] [data-value-counted]')), /\$0/, 'the shared row adds $0');
    const legend = await text(panel.locator('[data-bar-legend="Reviewed calculations vs provisional estimates"]'));
    assert.match(legend, /Reviewed calculation \$6\.8M/);
    assert.match(legend, /Provisional estimate \$2\.4M/);
    assert.match(await text(panel.locator('[data-value-row="N02-U01"]')), /not estimated/i, 'an old estimate says it is not estimated');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('2d: a bar label that does not fit its segment is hidden and moves to the tooltip and the legend', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  try {
    const { page } = ui;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
    await toView(page, 'Business');
    const panel = page.locator('[data-value-run-panel]');
    await panel.waitFor({ timeout: 15000 });
    const clipped = await panel.locator('[data-bar-segment]').evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll('[data-bar-label]')]
      .filter((l) => getComputedStyle(l).visibility !== 'hidden' && getComputedStyle(l).display !== 'none' && l.scrollWidth > el.clientWidth + 1).map((l) => l.textContent)));
    assert.deepEqual(clipped, [], 'no visible label is wider than its segment');
    const small = panel.locator('[data-bar-segment="REDUCE COST"]');
    assert.equal(await small.getAttribute('title'), 'REDUCE COST $100K', 'the hidden label is the tooltip');
    assert.equal(await small.getAttribute('data-label-hidden'), 'true');
    assert.match(await text(panel.locator('[data-bar-legend="By kind of value"]')), /REDUCE COST \$100K/, 'and it is in the legend');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
