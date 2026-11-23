// REQ-496b (FX-102): the Save step has no body scroll with live content: the review note, History with two versions, 3 drivers on with long input names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, fakeYearly, goTo, mountWizard, openCard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const est = (id, label, kind, def) => ({ id, label, kind, source: 'estimate', default: def, why: 'A common first estimate.' });
const driver = (id, label, verb, on) => ({ id, label, verb, on, why: 'Because.', asks: [
  est(`${id}_a`, 'Planned production volume of bakery items for each store every year', 'count', 12000), est(`${id}_b`, 'Average cost of one case of waste today', 'money', 450),
  est(`${id}_c`, 'Share of over-baked volume the use case stops', 'pct', 35), est(`${id}_d`, 'Hours of planner time saved on each case', 'hours', 2.5)] });
const REVIEW = { approved: true, model: 'databricks-claude-opus-4-5', reason: 'The three drivers are plausible for a bakery volume plan and every input is an estimate the owner can change before saving the value.' };
const LIVE_PLAN = { ...PLAN, review: REVIEW, drivers: [
  driver('risk_avoided', 'Losses avoided', 'AVOID RISK', true), driver('time_saved', 'Analyst time saved', 'REDUCE COST', true),
  driver('revenue_uplift', 'Customers kept', 'GROW REVENUE', true), driver('cost_cut', 'Fees avoided', 'REDUCE COST', false),
  driver('productivity', 'Team capacity freed', 'REDUCE COST', false)] };
const yearlyOf = (amount) => ({ verb: 'REDUCE COST', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }], total: { unit: 'USD', amount } });
const HISTORY = [
  { version: 2, saved_at: '2026-11-20T10:00:00Z', saved_by: 'amr@example.com', note: '', answers: {}, yearly: yearlyOf(777000) },
  { version: 1, saved_at: '2026-11-19T10:00:00Z', saved_by: 'sam@example.com', note: '', answers: {}, yearly: yearlyOf(300000) },
];
const SAVED = { version: 2, saved_at: '2026-11-20T10:00:00Z', saved_by: 'amr@example.com', yearly: yearlyOf(777000), answers: { currency: 'USD', attribution_pct: 100, drivers: {} } };
const mountLive = (app) => {
  app.post('/api/inspire/value/preview', (req, res) => res.json({ yearly: { ...fakeYearly(req.body), confidence: 'Medium' } }));
  mountWizard({ planReply: { plan: LIVE_PLAN }, saved: SAVED, history: HISTORY })(app);
};

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`N${width}: the Save step with the review note and History does not scroll at ${width}x${height}, tick and Accept and save in view`, async () => {
    const { ui, card, page } = await openCard(mountLive);
    try {
      await page.setViewportSize({ width, height });
      await card.getByRole('button', { name: 'Edit value' }).click();
      const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
      await dialog.waitFor();
      await goTo(dialog, 'save');
      await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
      await dialog.locator('[data-value-review]').waitFor({ timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-history-row]').length === 2, null, { timeout: 15000 }).catch(() => {});
      const fit = await page.evaluate(() => {
        const dlg = document.querySelector('[role=dialog]');
        const body = dlg.querySelector('[data-wizard-body]');
        const inView = (el) => { const r = el?.getBoundingClientRect(); return Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight); };
        const tick = [...dlg.querySelectorAll('input[type=checkbox]')].find((c) => /accept these terms/.test(c.closest('label')?.textContent || ''));
        return { scroll: body.scrollHeight, client: body.clientHeight, tick: inView(tick), save: inView(dlg.querySelector('[data-save-button]')),
          on: dlg.querySelectorAll('[data-accept-summary] li').length, review: Boolean(dlg.querySelector('[data-value-review]')), history: dlg.querySelectorAll('[data-history-row]').length };
      });
      console.log(`save-step body ${width}x${height}: scrollHeight ${fit.scroll} clientHeight ${fit.client}`);
      assert.equal(fit.on, 3, '3 drivers on');
      assert.equal(fit.review, true, 'review note present');
      assert.equal(fit.history, 2, 'two history rows in the fixture');
      assert.ok(fit.scroll <= fit.client + 1, `body scrolls: ${fit.scroll} > ${fit.client}`);
      assert.equal(fit.tick, true, 'tick in view');
      assert.equal(fit.save, true, 'Accept and save in view');
    } finally { await ui.close(); }
  });
}
