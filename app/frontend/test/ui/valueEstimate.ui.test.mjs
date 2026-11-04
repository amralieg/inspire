import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { valueEstimateOf } from '../../src/lib/v130UseCase.js';

test.after(closeBrowser);

const MEASURED = 'AED 2.4K\u20136K a year, if weekly sales value rises 2\u20135% (measured: 29,589 AED; the percentages are an assumption)';
const NOT_MEASURED = 'Value not measured yet: measure the total of amount over a time window.';
const measured = { value_estimate_text: MEASURED, 'Value Estimate': JSON.stringify({ status: 'measured', currency: 'AED', text: MEASURED }) };
const notMeasured = { value_estimate: JSON.stringify({ status: 'not measured yet', text: NOT_MEASURED }) };

function withUseCases(results, edit) {
  return {
    ...results,
    domains: results.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((uc) => ({ ...uc, ...(edit[uc.No] || {}) })) })),
  };
}

test('one helper reads the value line from the tracking text or the stored estimate, and nothing without one', () => {
  assert.deepEqual(valueEstimateOf(measured), { text: MEASURED, measured: true, currency: 'AED' });
  assert.deepEqual(valueEstimateOf(notMeasured), { text: NOT_MEASURED, measured: false, currency: null });
  assert.equal(valueEstimateOf({}), null);
  assert.equal(valueEstimateOf(null), null);
  assert.equal(valueEstimateOf({ value_estimate_text: '  ', value_estimate: '{not json' }), null);
});

test('the catalog list shows the value line on each card, bold when measured and plain when not measured yet', async () => {
  const results = withUseCases(REVIEW_RESULTS, { 'N01-U01': measured, 'N01-U02': notMeasured });
  const ui = await openUi('results', { ...REVIEW_STATE, results });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[aria-expanded]').first().waitFor();
    const card = (name) => list.locator('[aria-expanded]').filter({ hasText: name });
    assert.equal((await card('Predict churn').locator('[data-value-estimate="measured"]').innerText()).trim(), MEASURED);
    assert.equal((await card('Score upsell').locator('[data-value-estimate="not-measured"]').innerText()).trim(), NOT_MEASURED);
    assert.equal(await card('Forecast stock').locator('[data-value-estimate]').count(), 0, 'no value line without an estimate');
    assert.doesNotMatch(await list.innerText(), /a target the sponsor sets/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Build list tile and the Build header show the same value line', async () => {
  const ui = await openUi('implement', { useCase: { ...HARNESS_USE_CASE, ...measured } });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const tile = page.getByRole('navigation', { name: 'Use cases' }).getByRole('button').filter({ hasText: 'Predict churn' });
    await tile.locator('[data-value-estimate="measured"]').waitFor({ timeout: 15000 });
    assert.equal((await tile.locator('[data-value-estimate]').innerText()).trim(), MEASURED);
    const all = await page.locator('[data-value-estimate="measured"]').allInnerTexts();
    assert.ok(all.length >= 2 && all.every((text) => text.trim() === MEASURED), JSON.stringify(all));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
