// FX-34 (REQ-441, REQ-448; W16 D4/D12/D13): bulk Calculate turns estimates into calculated values and skips only calculated ones;
// Build next and the card show the same value for one use case; the Discover value sentence reads clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { DEFAULTS, PLAN } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { openReader } from './reviewRows.mjs';
import { valueEstimateOf } from '../../src/lib/v130UseCase.js';

test.after(closeBrowser);

const yearlyOf = (amount, calculated) => ({ verb: 'REDUCE COST', period: 'Per Year', estimated: !calculated, calculated, currency: 'USD', total: { unit: 'USD', amount }, parts: [],
  groups: { grouping_label: 'By region', covered: 3, of: 3 }, case_noun: 'case', attribution_pct: 100 });
const savedOf = (amount, calculated) => ({ version: 1, answers: { shape: 2, currency: 'USD', attribution_pct: 100, drivers: {}, calculated, plan: { basis: 'use_case' } },
  yearly: yearlyOf(amount, calculated), saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false });
const EMPTY_TOTALS = { run: { totals: [], n: 0, n_calculated: 0, n_estimated: 0, n_none: 0, by_verb: [] }, use_cases: {} };

function mountWith({ answers = {}, totals = EMPTY_TOTALS, puts = [] } = {}) {
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(totals));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
    app.post('/api/inspire/value/case-plan', (req, res) => res.json({ plan: { ...PLAN, use_case_id: req.body.use_case_id, basis: 'use_case' } }));
    app.put('/api/inspire/value/answers', (req, res) => {
      puts.push(req.body);
      res.json({ version: 2, answers: req.body.answers, yearly: yearlyOf(4100000, req.body.answers.calculated === true), disclaimer: 'x' });
    });
  };
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const poll = async (check, what, timeout = 15000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('2c: bulk calculate on an estimated row sends the requests and the row ends calculated; only a calculated row is skipped, and the dialog says so', async () => {
  const puts = [];
  const answers = { 'N01-U01': savedOf(9000000, true), 'N01-U02': savedOf(25300000, false) };
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountWith({ answers, puts }) });
  try {
    const { page } = ui;
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
    for (const n of ['Predict churn', 'Score upsell']) await page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check();
    await page.getByRole('button', { name: 'Calculate value for 2', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Calculating value' });
    await panel.waitFor();
    await poll(() => puts.length === 1, 'the estimated row is saved');
    assert.equal(puts[0].use_case_id, 'N01-U02', 'the estimate is recalculated');
    assert.equal(puts[0].answers.calculated, true, 'bulk saves a calculated value, not another estimate');
    await poll(async () => (await panel.locator('[data-bulk-row="N01-U02"]').getAttribute('data-bulk-state')) === 'done', 'the row ends done');
    assert.match(await text(panel.locator('[data-bulk-row="N01-U01"]')), /Skipped: already calculated/);
    assert.match(await text(panel), /1 already calculated, skipped/, 'the dialog says what it skipped and why');
    await poll(async () => (await page.locator('[data-use-case-no="N01-U02"] [data-value-box]').getAttribute('data-value-box-state')) === 'calculated', 'the card ends calculated');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

const evidence = (t) => JSON.stringify({ tables: { [t]: { columns: [] } } });
const discover = (text) => JSON.stringify({ status: 'estimated', currency: 'USD', text });
const BUILD_USE_CASES = ['N01-U01', 'N01-U02', 'N01-U03', 'N01-U04', 'N02-U01'].map((id, i) => ({ id, use_case: `Case ${i}`, name_with_technique: `Case ${i}`, primary_table: 'main.s.orders',
  tables_involved: 'main.s.orders', data_evidence: evidence('main.s.orders'), inspire_score: String(5 + i), value_estimate: discover('USD 103K-309.1K a year (reporting currency USD (default)), if sales rise 5-15%') }));
const BUILD_TOTALS = { run: { totals: [{ currency: 'USD', amount: 4500000, calculated: 0, estimated: 4500000 }], n: 5, n_calculated: 0, n_estimated: 5, n_none: 0, by_verb: [] },
  use_cases: Object.fromEntries(BUILD_USE_CASES.map((u, i) => [u.id, { status: 'estimated', verb: 'AVOID RISK', amount: 500000 + i * 200000, currency: 'USD', counted_amount: 500000 + i * 200000 }])) };

test('2e: Build next and the card show the same value for one use case', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS, useCases: BUILD_USE_CASES }, '', { mount: mountWith({ totals: BUILD_TOTALS }) });
  try {
    const { page } = ui;
    // REQ-511: Build next left Review (D3); the same one value now shows on the row's value box and on the reader card.
    const row = page.locator('[data-use-case-row]').first();
    await row.waitFor({ timeout: 20000 });
    const id = await row.getAttribute('data-use-case-no');
    const line = row.locator('[data-value-box] [data-value-amount]');
    await line.waitFor({ timeout: 15000 });
    const reader = await openReader(page, row);
    const card = reader.locator('[data-value-amount]').first();
    await card.waitFor({ timeout: 15000 });
    await poll(async () => (await text(card)) === (await text(line)), `card and row agree for ${id}`);
    assert.match(await text(line), /^\$[\d.]+[KM]$/, 'the row shows the amount the totals give');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('D4: the Discover value sentence has no nested brackets and one precision', () => {
  const got = valueEstimateOf({ value_estimate: discover('USD 103K-309.1K a year (reporting currency USD (default)), if daily sales drop'), value_estimate_text: '' });
  assert.equal(got.text, 'USD 103K-309K a year (currency USD, default), if daily sales drop');
  const assumed = valueEstimateOf({ value_estimate: discover('AED 2.4K-6K a year (currency assumed: AED (reporting currency))') });
  assert.equal(assumed.text, 'AED 2.4K-6K a year (currency assumed: AED, the reporting currency)');
  assert.equal(valueEstimateOf({ value_estimate: discover('USD 1.234M a year') }).text, 'USD 1.23M a year');
});
