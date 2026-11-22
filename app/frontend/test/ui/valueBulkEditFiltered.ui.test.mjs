// FX-55 (REQ-448 follow-up, D50): Edit on a "Check this value" bulk row opens that use case's value editor even when its card is filtered out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { DEFAULTS, PLAN, fakeYearly, goTo, openCard, openWizard } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

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


async function toCheckRow(page) {
  await page.getByRole('region', { name: 'Use case list' }).locator('[aria-expanded]').first().waitFor();
  await page.getByRole('checkbox', { name: 'Select Predict churn', exact: true }).check();
  await page.getByRole('button', { name: 'Calculate value for 1', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Calculating value' });
  await panel.locator('[data-bulk-row="N01-U01"][data-bulk-state="done"] [data-bulk-check]').waitFor({ timeout: 15000 });
  return panel;
}

test('FX-55: Edit on a bulk row opens the value editor when the use case card is filtered out', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mount({ puts: [], check: true }) });
  const page = ui.page;
  try {
    const panel = await toCheckRow(page);
    await page.getByPlaceholder('Search use cases...').fill('zzz no such use case zzz');
    await page.locator('[data-use-case-id="N01-U01"]').waitFor({ state: 'detached', timeout: 5000 });
    await panel.locator('[data-bulk-row="N01-U01"]').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('dialog', { name: /^Calculating Value at Stake for / }).waitFor({ timeout: 5000 });
  } finally { await ui.close(); }
});

test('FX-55: Edit on a bulk row still opens the value editor when the card is visible', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mount({ puts: [], check: true }) });
  const page = ui.page;
  try {
    const panel = await toCheckRow(page);
    await panel.locator('[data-bulk-row="N01-U01"]').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('dialog', { name: /^Calculating Value at Stake for / }).waitFor({ timeout: 5000 });
  } finally { await ui.close(); }
});
