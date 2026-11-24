// REQ-496b (FX-100): the Save step fits the dialog body with live-size content (5 drivers, 4 on, 4 inputs each), at 1440x900 and 1280x800.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, fakeYearly, goTo, mountWizard, openCard, openWizard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const est = (id, label, kind, def) => ({ id, label, kind, source: 'estimate', default: def, why: 'A common first estimate.' });
const driver = (id, label, verb, on) => ({ id, label, verb, on, why: 'Because.', asks: [
  est(`${id}_a`, 'Cases handled every year', 'count', 12000), est(`${id}_b`, 'Cost of one case today', 'money', 450),
  est(`${id}_c`, 'Share the use case stops', 'pct', 35), est(`${id}_d`, 'Hours saved on each case', 'hours', 2.5)] });
const LIVE_PLAN = { ...PLAN, drivers: [
  driver('risk_avoided', 'Losses avoided', 'AVOID RISK', true), driver('time_saved', 'Analyst time saved', 'REDUCE COST', true),
  driver('revenue_uplift', 'Customers kept', 'GROW REVENUE', true), driver('cost_cut', 'Fees avoided', 'REDUCE COST', true),
  driver('productivity', 'Team capacity freed', 'REDUCE COST', false)] };
// The shared preview, plus the confidence a live server returns; registered first so it answers.
const mountLive = (app) => {
  app.post('/api/inspire/value/preview', (req, res) => res.json({ yearly: { ...fakeYearly(req.body), confidence: 'Medium' } }));
  mountWizard({ planReply: { plan: LIVE_PLAN } })(app);
};

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`L${width}: the live-size Save step does not scroll at ${width}x${height}, with the tick and Accept and save in view`, async () => {
    const { ui, card, page } = await openCard(mountLive);
    try {
      await page.setViewportSize({ width, height });
      const dialog = await openWizard(page, card);
      await goTo(dialog, 'save');
      await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
      const fit = await page.evaluate(() => {
        const dlg = document.querySelector('[role=dialog]');
        const body = dlg.querySelector('[data-wizard-body]');
        const inView = (el) => { const r = el?.getBoundingClientRect(); return Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight); };
        const tick = [...dlg.querySelectorAll('input[type=checkbox]')].find((c) => /accept these terms/.test(c.closest('label')?.textContent || ''));
        const save = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close');
        return { scroll: body.scrollHeight, client: body.clientHeight, tick: inView(tick), save: inView(save) };
      });
      console.log(`save-step body ${width}x${height}: scrollHeight ${fit.scroll} clientHeight ${fit.client}`);
      assert.ok(fit.scroll <= fit.client + 1, `body scrolls: ${fit.scroll} > ${fit.client}`);
      assert.equal(fit.tick, true, 'tick in view');
      assert.equal(fit.save, true, 'Close in view');
    } finally { await ui.close(); }
  });
}
