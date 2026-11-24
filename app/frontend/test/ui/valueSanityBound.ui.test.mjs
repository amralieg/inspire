// FX-51 (REQ-448, W18a D50): a value outside 100K-100M is never shown as calculated. A bulk row whose plan carries value_check is saved as an
// estimate and says "Check this value: ... is outside the usual 100K-100M range" with Edit; a person's own Save of such a number is allowed
// and shows the same note once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { DEFAULTS, PLAN, fakeYearly, goTo, openCard, openWizard } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const NOTE = /Check this value: \$23\.4K is outside the usual 100K-100M range/;
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const small = (body, calculated = false) => ({ ...fakeYearly(body, { calculated }), total: { unit: 'USD', amount: 23400 } });

function mount({ puts, check }) {
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
    app.post('/api/inspire/value/case-plan', (_req, res) => res.json({ plan: check ? { ...PLAN, value_check: { amount: 23400, low: 100000, high: 100000000 } } : PLAN }));
    app.post('/api/inspire/value/preview', (req, res) => res.json({ yearly: small(req.body) }));
    app.put('/api/inspire/value/answers', (req, res) => {
      puts.push(req.body);
      res.json({ version: 1, yearly: small({ plan: req.body.answers.plan, answers: req.body.answers }, req.body.answers.calculated), disclaimer: 'x' });
    });
  };
}

test('FX-51: a bulk row whose plan is outside the range is saved as an estimate and shows the note with Edit', async () => {
  const puts = [];
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mount({ puts, check: true }) });
  const page = ui.page;
  try {
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
    await page.getByRole('checkbox', { name: 'Select Predict churn', exact: true }).check();
    await page.getByRole('button', { name: 'Calculate value for 1', exact: true }).click();
    const row = page.getByRole('dialog', { name: 'Calculating value' }).locator('[data-bulk-row="N01-U01"][data-bulk-state="done"]');
    await row.waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, false, 'an out-of-range value is not saved as calculated');
    assert.match(await text(row), NOTE);
    assert.doesNotMatch(await text(row), /per year/);
    assert.equal(await row.getByRole('button', { name: 'Edit', exact: true }).count(), 1);
  } finally { await ui.close(); }
});

test('FX-51: a bulk row in range is saved as calculated with no note', async () => {
  const puts = [];
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mount({ puts, check: false }) });
  const page = ui.page;
  try {
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
    await page.getByRole('checkbox', { name: 'Select Predict churn', exact: true }).check();
    await page.getByRole('button', { name: 'Calculate value for 1', exact: true }).click();
    const row = page.getByRole('dialog', { name: 'Calculating value' }).locator('[data-bulk-row="N01-U01"][data-bulk-state="done"]');
    await row.waitFor({ timeout: 15000 });
    assert.equal(puts[0].answers.calculated, true);
    assert.doesNotMatch(await text(row), /Check this value/);
  } finally { await ui.close(); }
});

test('FX-51: a person Save of an out-of-range number is allowed and the dialog shows the note once', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mount({ puts, check: false }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.equal(await dialog.locator('[data-value-range-note]').count(), 1);
    assert.match(await text(dialog.locator('[data-value-range-note]')), NOTE);
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Accept and save', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, true, 'their own Save stays their choice');
  } finally { await ui.close(); }
});
