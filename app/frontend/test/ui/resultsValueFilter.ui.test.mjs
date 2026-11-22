// REQ-472 (f): Results can filter use cases by value: All / Calculated / Not calculated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { DEFAULTS } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const SAVED = { version: 1, saved_at: '2026-11-20T10:00:00Z', answers: { shape: 2, calculated: true },
  yearly: { verb: 'INCREASE REVENUE', period: 'Per Year', calculated: true, entries: [{ kind: 'money', unit: 'USD', amount: 500000 }] } };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: { 'N01-U01': SAVED } }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
};

test('F1: the Value filter shows Calculated, Not calculated or All, and the active chip clears it', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[aria-expanded]').first().waitFor();
    await list.locator('[data-value-yearly]').first().waitFor({ timeout: 15000 });
    const total = await list.locator('[aria-expanded]').count();
    assert.ok(total >= 3);
    const filter = page.getByRole('combobox', { name: 'Value' });
    await filter.selectOption('calculated');
    assert.equal(await list.locator('[aria-expanded]').count(), 1);
    await filter.selectOption('not_calculated');
    assert.equal(await list.locator('[aria-expanded]').count(), total - 1);
    await filter.selectOption('all');
    assert.equal(await list.locator('[aria-expanded]').count(), total);
    await filter.selectOption('calculated');
    await page.getByRole('button', { name: 'Clear the Value filter' }).click();
    assert.equal(await filter.inputValue(), 'all');
    assert.equal(await list.locator('[aria-expanded]').count(), total);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
