// REQ-434: every surface that renders a calculated value also renders the disclaimer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { VALUE_DISCLAIMER, VALUE_DISCLAIMER_SHORT } from '../../src/lib/valueLabels.js';

test.after(closeBrowser);

const FULL = 'This value is a calculation from your data, not a validated business case. A specialist value team must verify and sign off every number before it is shared or used in a decision.';
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const money = [{ kind: 'money', unit: 'USD', amount: 120000 }];
const yearly = { verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount: 15e6 }],
  basis: { sampled_records: 1200, eligible_records: 48000, days: 90 } };
// FX-34 (REQ-448): the one run value the Review header, the Start panel and the run cards render.
const RUN_VALUE = { totals: [{ currency: 'USD', amount: 120000, calculated: 120000, estimated: 0 }], n: 1, n_calculated: 1, n_estimated: 0, n_measured: 0, n_none: 0, n_shared: 0 };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: { 'N01-U01': { at_stake: money, saved: [], measured: true } }, run: { at_stake: money, saved: [], mvps_measured: 1 } }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': yearly } }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(req.query.session_id
    ? { run: { ...RUN_VALUE, excluded: [], by_verb: [] }, use_cases: {}, run_value: RUN_VALUE }
    : { runs: [{ session_id: '42', name: 'Acme', ...RUN_VALUE, run_value: RUN_VALUE }], all: RUN_VALUE, truncated: false, cap: 20 }));
};

test('the disclaimer is one constant with the agreed words', () => {
  assert.equal(VALUE_DISCLAIMER, FULL);
  assert.equal(VALUE_DISCLAIMER_SHORT, 'Unverified estimate');
});

// REQ-438 v8: the value box has no short line under "Per year"; it carries the full text in its tooltip, and the short line sits in
// "How we got this number" (source check below).
test('the card value box carries the full text in its tooltip', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const card = page.getByRole('region', { name: 'Use case list' }).locator('[aria-expanded]').filter({ hasText: 'Predict churn' });
    const line = card.locator('[data-value-yearly]');
    await line.waitFor({ timeout: 15000 });
    assert.equal((await line.locator('[data-value-period]').innerText()).trim(), 'Per year');
    assert.ok(((await line.getAttribute('title')) || '').includes(FULL), 'the tooltip carries the full text');
  } finally {
    await ui.close();
  }
});

// FX-34 (REQ-448, W16 D9): the Review header shows the run value (the header MVP badge is gone), so the disclaimer moved with it.
test('the run value in the Review header, the value across runs and each run card on the Choose page carry the disclaimer', async () => {
  const results = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  try {
    const header = results.page.locator('[data-run-header-value]');
    await header.locator('[data-run-value-total]').waitFor({ timeout: 15000 });
    assert.equal(await header.locator('[data-value-disclaimer]').getAttribute('title'), FULL, 'the header run value carries the disclaimer');
  } finally {
    await results.close();
  }
  const choose = await openUi('app', { ...REVIEW_STATE }, '', { mount });
  try {
    await choose.page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const overall = choose.page.locator('[data-value-overall]');
    await overall.waitFor({ timeout: 20000 });
    await overall.locator('[data-value-disclaimer]').waitFor({ timeout: 15000 });
    assert.ok((await overall.innerText()).includes(FULL), 'value across runs carries the full text');
    const runValue = choose.page.locator('[data-run="42"] [data-run-value]');
    await runValue.locator('[data-run-value-total]').waitFor({ timeout: 15000 });
    assert.equal(await runValue.locator('[data-value-disclaimer]').getAttribute('title'), FULL, 'a run value carries the disclaimer');
  } finally {
    await choose.close();
  }
});

test('the rule estimate line and the drawer carry the disclaimer', () => {
  const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
  assert.match(read('components/ValueEstimateLine.jsx'), /ValueDisclaimer|VALUE_DISCLAIMER/, 'the rule estimate line renders it');
  assert.match(read('components/ValueBox.jsx'), /VALUE_DISCLAIMER/, 'the card and drawer value box render it');
  assert.match(read('components/ValueHow.jsx'), /ValueDisclaimer/, 'How we got this number renders the short line');
  assert.match(read('components/CalculateValueDialog.jsx') + read('components/valueWizard/StepSave.jsx') + read('pages/ResultsPage.jsx'), /ValueDisclaimer|VALUE_DISCLAIMER/, 'the Calculate result renders it');
});
