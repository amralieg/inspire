// REQ-432: the use case card shows the value per year under the Inspire score, or a Calculate button that asks the Value at stake questions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const YEARLY_ENTRY = (amount) => ({ verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }],
  basis: { sampled_records: 1200, eligible_records: 48000, days: 90 } });
const posts = [];
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/overall', (_req, res) => res.json({ at_stake: [], saved: [], runs: 0, businesses: 0 }));
  app.get('/api/inspire/value/runs', (_req, res) => res.json({ runs: {} }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': YEARLY_ENTRY(15000000) } }));
  app.post('/api/inspire/value/estimate', (req, res) => { posts.push(req.body); res.json({ yearly: YEARLY_ENTRY(405556) }); });
};

test('a measured card shows the verb line, "$15M (estimated)" and "Per Year" below the score, and a card with no value shows Calculate', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[aria-expanded]').first().waitFor();
    const card = (name) => list.locator('[aria-expanded]').filter({ hasText: name });
    const line = card('Predict churn').locator('[data-value-yearly]');
    await line.waitFor({ timeout: 15000 });
    assert.equal((await line.locator('[data-value-verb]').innerText()).trim().toUpperCase(), 'INCREASE REVENUE');
    assert.equal((await line.locator('[data-value-amount]').innerText()).replace(/\s+/g, ' ').trim(), '$15M (estimated)');
    assert.equal((await line.locator('[data-value-period]').innerText()).trim(), 'Per Year');
    const score = await card('Predict churn').locator('[title="Inspire composite score"]').first().boundingBox();
    const box = await line.boundingBox();
    assert.ok(box.y >= score.y + score.height - 1, 'the value line sits below the Inspire score');
    assert.equal(await card('Predict churn').locator('[data-value-calculate]').count(), 0);

    const empty = card('Score upsell');
    await empty.locator('[data-value-calculate]').waitFor();
    assert.equal((await empty.locator('[data-value-calculate]').innerText()).trim(), 'Calculate');
    assert.equal(await empty.locator('[data-value-yearly]').count(), 0, 'no number, never 0, for a value that was not calculated');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Calculate opens the Value at stake questions, submitting calls the estimate endpoint, and the card then shows the value', async () => {
  posts.length = 0;
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: (app) => {
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    mount(app);
  } });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[aria-expanded]').first().waitFor();
    const card = list.locator('[aria-expanded]').filter({ hasText: 'Predict churn' });
    await card.locator('[data-value-calculate]').click();
    const dialog = page.getByRole('dialog', { name: 'Calculate value at stake' });
    await dialog.waitFor();
    await dialog.getByRole('list', { name: 'Money decisions' }).waitFor();
    assert.match(await dialog.innerText(), /Value at stake/);
    await dialog.getByRole('button', { name: 'Calculate', exact: true }).click();
    const line = card.locator('[data-value-yearly]');
    await line.waitFor({ timeout: 15000 });
    assert.equal((await line.locator('[data-value-amount]').innerText()).replace(/\s+/g, ' ').trim(), '$406K (estimated)');
    assert.equal(posts.length, 1, 'one estimate request');
    assert.equal(posts[0].use_case_id, 'N01-U01');
    assert.ok(posts[0].answers && posts[0].answers.money, 'the answers travel with the request');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a failed estimate shows one line with a retry on the card, never 0 and never blank', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: (app) => {
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.post('/api/inspire/value/estimate', (_req, res) => res.status(422).json({ error: 'The table has no date column to scale the sample to a year.' }));
    mount(app);
  } });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[aria-expanded]').first().waitFor();
    const card = list.locator('[aria-expanded]').filter({ hasText: 'Predict churn' });
    await card.locator('[data-value-calculate]').click();
    const dialog = page.getByRole('dialog', { name: 'Calculate value at stake' });
    await dialog.getByRole('button', { name: 'Calculate', exact: true }).click();
    const failed = page.locator('[data-value-failed]');
    await failed.waitFor({ timeout: 15000 });
    assert.match(await failed.innerText(), /no date column/);
    assert.equal(await page.getByRole('button', { name: 'Retry' }).count() > 0, true);
    assert.equal(await card.locator('[data-value-yearly]').count(), 0);
  } finally {
    await ui.close();
  }
});
