// REQ-434: every surface that renders a calculated value also renders the disclaimer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { VALUE_DISCLAIMER, VALUE_DISCLAIMER_SHORT } from '../../src/lib/valueLabels.js';

test.after(closeBrowser);

const FULL = 'This value is a calculation from your data, not a validated business case. A specialist value team must verify and sign off every number before it is shared or used in a decision.';
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const money = [{ kind: 'money', unit: 'USD', amount: 120000 }];
const yearly = { verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount: 15e6 }],
  basis: { sampled_records: 1200, eligible_records: 48000, days: 90 } };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: { 'N01-U01': { at_stake: money, saved: [], measured: true } }, run: { at_stake: money, saved: [], mvps_measured: 1 } }));
  app.get('/api/inspire/value/overall', (_req, res) => res.json({ at_stake: money, saved: [], runs: 1, businesses: 1 }));
  app.get('/api/inspire/value/runs', (_req, res) => res.json({ runs: { 42: { at_stake: money, saved: [], mvps_measured: 1 } } }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': yearly } }));
};

test('the disclaimer is one constant with the agreed words', () => {
  assert.equal(VALUE_DISCLAIMER, FULL);
  assert.equal(VALUE_DISCLAIMER_SHORT, 'Unverified estimate');
});

test('the card shows the short line under "Per Year" and the full text in its tooltip', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const card = page.getByRole('region', { name: 'Use case list' }).locator('[aria-expanded]').filter({ hasText: 'Predict churn' });
    const line = card.locator('[data-value-yearly]');
    await line.waitFor({ timeout: 15000 });
    const short = line.locator('[data-value-disclaimer]');
    assert.equal((await short.innerText()).trim(), VALUE_DISCLAIMER_SHORT);
    const period = await line.locator('[data-value-period]').boundingBox();
    const shortBox = await short.boundingBox();
    assert.ok(shortBox.y >= period.y + period.height - 1, 'the short line sits under "Per Year"');
    assert.ok(((await line.getAttribute('title')) || '').includes(FULL), 'the tooltip carries the full text');
  } finally {
    await ui.close();
  }
});

test('the measured value badge on the Results page and the value across runs on the Choose page both carry the disclaimer', async () => {
  const results = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  try {
    const badge = results.page.locator('[data-value-badge]').first();
    await badge.waitFor({ timeout: 15000 });
    assert.ok((await badge.locator('xpath=..').innerText()).includes(FULL), 'a full disclaimer sits with the measured badge');
  } finally {
    await results.close();
  }
  const choose = await openUi('app', { ...REVIEW_STATE }, '', { mount });
  try {
    await choose.page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const overall = choose.page.locator('[data-value-overall]');
    await overall.waitFor({ timeout: 20000 });
    assert.ok((await overall.innerText()).includes(FULL), 'value across runs carries the full text');
    const runValue = choose.page.locator('[data-run="42"] [data-run-value]');
    await runValue.locator('[data-value-badge]').waitFor({ timeout: 15000 });
    assert.ok((await runValue.innerText()).includes(FULL), 'a run value carries the full text');
  } finally {
    await choose.close();
  }
});

test('the rule estimate line and the drawer carry the disclaimer', () => {
  const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
  assert.match(read('components/ValueEstimateLine.jsx'), /ValueDisclaimer|VALUE_DISCLAIMER/, 'the rule estimate line renders it');
  assert.match(read('components/CardValueLine.jsx'), /VALUE_DISCLAIMER/, 'the card and drawer line render it');
  assert.match(read('components/CalculateValueDialog.jsx') + read('pages/ResultsPage.jsx'), /ValueDisclaimer|VALUE_DISCLAIMER/, 'the Calculate result renders it');
});
