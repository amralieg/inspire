// REQ-432: the use case card shows the value per year beside the Inspire score (REQ-438 v8 value box), or a Calculate value box that opens the
// Calculate value wizard (REQ-436 v8: Next through the steps, Save on the last one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { goTo } from './valueWizardSupport.mjs';

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
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': YEARLY_ENTRY(15000000) } }));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
  app.put('/api/inspire/value/answers', (req, res) => { posts.push(req.body); res.json({ version: 1, yearly: YEARLY_ENTRY(405556), disclaimer: '' }); });
};

test('a measured card shows the value box with the verb, "$15M", "(estimated)" and "Per year" beside the score, and a card with no value shows Calculate value', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor();
    const card = (name) => list.locator('[data-use-case-row]').filter({ hasText: name });
    const line = card('Predict churn').locator('[data-value-yearly]');
    await line.waitFor({ timeout: 15000 });
    assert.equal((await line.locator('[data-value-verb]').innerText()).trim().toUpperCase(), 'INCREASE REVENUE');
    assert.equal((await line.locator('[data-value-amount]').innerText()).replace(/\s+/g, ' ').trim(), '$15M');
    assert.equal((await line.locator('[data-value-qualifier]').innerText()).trim(), 'Provisional estimate');
    assert.equal((await line.locator('[data-value-period]').innerText()).trim(), 'Per year');
    const score = await card('Predict churn').locator('[data-score-box]').first().boundingBox();
    const box = await line.boundingBox();
    assert.ok(Math.abs(box.y - score.y) <= 1 && box.x > score.x, 'the value box sits beside the Inspire score');
    assert.equal(await card('Predict churn').locator('[data-value-calculate]').count(), 0);

    const empty = card('Score upsell');
    await empty.locator('[data-value-calculate]').waitFor();
    assert.match((await empty.locator('[data-value-calculate]').innerText()).replace(/\s+/g, ' ').trim(), /^\+ Calculate value at stake$/);
    assert.equal(await empty.locator('[data-value-yearly]').count(), 0, 'no number, never 0, for a value that was not calculated');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Calculate opens the wizard, Save on its last step saves the answers on the server, and the card then shows the value', async () => {
  posts.length = 0;
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: (app) => {
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    mount(app);
  } });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor();
    const card = list.locator('[data-use-case-row]').filter({ hasText: 'Predict churn' });
    await card.locator('[data-value-calculate]').click();
    const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
    await dialog.waitFor();
    await dialog.getByRole('list', { name: 'Steps' }).waitFor();
    assert.match(await dialog.innerText(), /value at stake/i);
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const line = card.locator('[data-value-yearly]');
    await line.waitFor({ timeout: 15000 });
    // The v8 box counts up to the new figure over half a second.
    const amountOf = async () => (await line.locator('[data-value-amount]').innerText()).replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 30 && await amountOf() !== '$406K'; i += 1) await page.waitForTimeout(100);
    assert.equal(await amountOf(), '$406K');
    assert.equal((await line.locator('[data-value-qualifier]').innerText()).trim(), 'Provisional estimate');
    assert.equal(posts.length, 1, 'one save request');
    assert.equal(posts[0].use_case_id, 'N01-U01');
    assert.ok(posts[0].answers && posts[0].answers.shape === 2 && posts[0].answers.plan, 'the answers (shape 2, with the plan) travel with the request');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a failed save shows its one line in the box, keeps the box open, and the card shows no value', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: (app) => {
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.put('/api/inspire/value/answers', (_req, res) => res.status(422).json({ error: 'The table has no date column to scale the sample to a year.' }));
    mount(app);
  } });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor();
    const card = list.locator('[data-use-case-row]').filter({ hasText: 'Predict churn' });
    await card.locator('[data-value-calculate]').click();
    const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.getByRole('alert').waitFor({ timeout: 15000 });
    assert.match(await dialog.getByRole('alert').innerText(), /no date column/);
    assert.equal(await card.locator('[data-value-yearly]').count(), 0);
  } finally {
    await ui.close();
  }
});
