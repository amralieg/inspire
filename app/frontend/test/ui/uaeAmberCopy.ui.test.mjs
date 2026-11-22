// REQ-305 (D-uae-03): the Data Management search summary counts the distinct picked tables that match.
// REQ-444 (D-uae-04): the Review refine banner says each line in plain words with the real numbers and lists every line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { summarizePairs } from '../../src/lib/scoreRefine.js';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const COL = (name, type, n) => ({ column_name: name, data_type: type, ordinal_position: n });
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers', 'segment_rollup'] },
  columnsByTable: {
    'main.s.orders': [COL('order_id', 'BIGINT', 1), COL('brand', 'STRING', 2)],
    'main.s.customers': [COL('customer_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('segment', 'STRING', 3)],
    'main.s.segment_rollup': [COL('segment', 'STRING', 1), COL('segment_id', 'BIGINT', 2), COL('customer_segment', 'STRING', 3)],
  },
  readinessRows: [{ row_count: '1200' }],
};

test('REQ-305: four matching columns in two of the three picked tables read "4 columns in 2 tables"', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await idle(page);
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    for (const t of ['orders', 'customers', 'segment_rollup']) await page.locator(`button[title="${t}"]`).click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.getByRole('searchbox', { name: 'Search column names' }).waitFor({ timeout: 15000 });
    await until(async () => (await page.locator('[data-search-hint]').count()) === 1, 'the search hint shows', 15000);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('segment');
    await page.locator('[data-column-hit="segment"]').first().waitFor({ timeout: 10000 });
    const text = (await page.locator('[data-column-search]').innerText()).replace(/\s+/g, ' ');
    assert.match(text, /4 columns in 2 tables/);
    assert.doesNotMatch(text, /in 4 tables/);
  } finally {
    await ui.close();
  }
});

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const entry = (amount) => ({ verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }],
  basis: { sampled_records: 1200, eligible_records: 48000, days: 90 } });
const results = () => {
  const out = structuredClone(REVIEW_RESULTS);
  for (const domain of out.domains) {
    for (const u of domain.use_cases) {
      if (u.No === 'N01-U01' || u.No === 'N01-U02') { u.best_of_best = 'N'; delete u.best_of_best_rank; }
      if (u.No === 'N01-U01') u.inspire_score = '9.0';
      if (u.No === 'N01-U02') u.inspire_score = '8.5';
    }
  }
  return out;
};
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': entry(1e4), 'N01-U02': entry(1.2e6) } }));
};

test('REQ-444: the refine line says what the use case earns, how many times the other, and its scores, with no bare "120.3x"', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: results() }, '', { mount });
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.waitFor({ timeout: 15000 });
    const text = (await banner.innerText()).replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /is worth \d+(\.\d+)?x/, 'no bare ratio');
    assert.match(text, /Score upsell is worth \$1\.2M a year, 120 times Predict churn \(\$10K a year\)/);
    assert.match(text, /score of 8\.5 is below 9\.0/);
    assert.match(text, /Refine its score to 9\.05/);
  } finally {
    await ui.close();
  }
});

test('REQ-444: up to five lines all show, with no "and N more"', () => {
  const mk = (i) => ({ lower: { id: `L${i}`, name: `L${i}`, start: 5 }, higher: { id: `H${i}`, name: `H${i}`, start: 6 }, ratio: 2 + i, kind: 'money', unit: 'USD', lowerAmount: 100 * (i + 1), higherAmount: 10 });
  const same = [0, 1].map(mk).map((p) => ({ ...p, lowerAmount: 500 }));
  assert.equal(summarizePairs([0, 1, 2, 3, 4].map(mk)).more.length, 0);
  assert.equal(summarizePairs(same).more.length, 0, 'two lines with one amount still both show');
  assert.equal(summarizePairs([0, 1, 2, 3, 4, 5, 6].map(mk)).shown.length, 5);
});
