// REQ-457 (FX-52, W18a D51): a use case with no calculated value shows "No value yet" and a Calculate button in the Build wizard's value panel.
// Inspire's own estimate (totals status "estimated" with nothing saved) is not a calculated value, so it does not hide the prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { PLAN, fakeYearly } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' } };
const ID = 'N01-U01';
const totalsOf = (e) => ({ run: { totals: [], n: 1, n_calculated: 0, n_estimated: 0, n_none: 0, n_measured: 0, by_verb: [] }, use_cases: { [ID]: e } });
const mountWith = (totals) => (app) => {
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(totals));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
  app.post('/api/inspire/value/case-plan', (_req, res) => res.json({ plan: PLAN }));
  app.post('/api/inspire/value/preview', (req, res) => res.json({ yearly: fakeYearly(req.body) }));
};

for (const [name, entry] of [['no estimate', { status: 'none', verb: '', amount: null, currency: '' }],
  ["Inspire's own estimate", { status: 'estimated', verb: 'REDUCE COST', amount: 120000, currency: 'USD' }],
  ['an out-of-date estimate', { status: 'not_estimated', stale: true, reason: 'Old', verb: '', amount: null, currency: '' }]]) {
  test(`uncalculated (${name}): "No value yet" and Calculate, which opens the dialog; no Edit`, async () => {
    const ui = await openUi('valuePanel', ME, '', { mount: mountWith(totalsOf(entry)) });
    try {
      const panel = ui.page.locator('[data-mvp-value]');
      await panel.waitFor({ timeout: 15000 });
      await panel.getByText('No value yet', { exact: true }).waitFor({ timeout: 15000 });
      assert.equal(await panel.getByRole('button', { name: 'Edit', exact: true }).count(), 0);
      await panel.getByRole('button', { name: /Calculate/ }).first().click();
      await ui.page.getByRole('dialog', { name: 'Calculate value at stake' }).waitFor();
      assert.deepEqual(ui.pageErrors, []);
    } finally { await ui.close(); }
  });
}
