// REQ-481 (FX-76): the full disclaimer sits under the use case value in the MVP value panel, and only when a value is shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, goToStep, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { PLAN, fakeYearly } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const { full: FULL } = JSON.parse(readFileSync(new URL('../../../backend/lib/valueDisclaimer.json', import.meta.url), 'utf8'));
const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const ID = 'N01-U01';
const yearly = { verb: 'REDUCE COST', period: 'Per Year', estimated: false, calculated: true, currency: 'USD', total: { unit: 'USD', amount: 2390000 }, parts: [],
  groups: { grouping_label: 'By region', covered: 3, of: 3 }, case_noun: 'review case', attribution_pct: 100, version: 3, stale: false };
const answer = { version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 100, drivers: {}, calculated: true }, yearly, saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false };
const RUN = { totals: [], n: 1, n_calculated: 0, n_estimated: 0, n_none: 0, n_measured: 0, by_verb: [] };

async function openPanel(entry, answers) {
  const mount = (app) => {
    app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json({ run: RUN, use_cases: { [ID]: entry } }));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers }));
    app.post('/api/inspire/value/case-plan', (_req, res) => res.json({ plan: PLAN }));
    app.post('/api/inspire/value/preview', (req, res) => res.json({ yearly: fakeYearly(req.body) }));
  };
  const ui = await openUi('wizard', ME, '', { mount });
  await goToStep(ui.page, 'Review & build');
  const panel = ui.page.locator('[data-mvp-value]');
  await panel.waitFor({ timeout: 15000 });
  return { ui, panel };
}

test('a calculated value in the MVP value panel does not repeat the full text (REQ-576)', async () => {
  const { ui, panel } = await openPanel({ status: 'calculated', verb: 'REDUCE COST', amount: 2390000, currency: 'USD' }, { [ID]: answer });
  try {
    await panel.locator('[data-value-amount]').waitFor({ timeout: 15000 });
    // REQ-576 (supersedes REQ-481 here): the disclaimer shows once at the top of the page, so the panel itself does not repeat it.
    assert.ok(!(await panel.innerText()).replace(/\s+/g, ' ').includes(FULL), 'the panel does not repeat the full text');
  } finally { await ui.close(); }
});

test('no value yet: the MVP value panel has no disclaimer', async () => {
  const { ui, panel } = await openPanel({ status: 'none', verb: null, amount: null, currency: null }, {});
  try {
    await panel.locator('[data-value-none]').waitFor({ timeout: 15000 });
    assert.ok(!(await panel.innerText()).includes(FULL));
  } finally { await ui.close(); }
});
