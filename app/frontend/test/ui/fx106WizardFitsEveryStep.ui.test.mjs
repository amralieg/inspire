// REQ-496b (FX-106): every step of the value wizard fits the dialog body (no scroll) at 1440x900 and 1280x800 with the largest live content:
// all 5 drivers on with long names and 5 inputs each (data and estimate), 3 market factors, the review note, History with 2 versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, fakeYearly, goTo, mountWizard, next, openCard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const est = (id, label, kind, def) => ({ id, label, kind, source: 'estimate', default: def, why: 'A common first estimate based on how similar teams plan this work.' });
const dat = (id, label, kind, metric) => ({ id, label, kind, source: 'data', metric });
const driver = (id, label, verb) => ({ id, label, verb, on: true, why: 'Because every case that the use case stops is a cost the business does not pay again.', asks: [
  dat(`${id}_n`, 'Cases handled every year across all stores', 'count', 'records'), dat(`${id}_m`, 'Money at risk in one case on average', 'money', 'amt'),
  est(`${id}_a`, 'Planned production volume of bakery items for each store every year', 'count', 12000), est(`${id}_b`, 'Average cost of one case of waste today', 'money', 450),
  est(`${id}_c`, 'Share of over-baked volume the use case stops', 'pct', 35)] });
const REVIEW = { approved: true, model: 'databricks-claude-opus-4-5', reason: 'The drivers are plausible for a bakery volume plan and every input is an estimate the owner can change before saving the value.' };
const factor = (id, label) => ({ id, label, why: 'Outside signals can lift or lower the revenue this use case wins over the next twelve months.', likely_pct: 3, min_pct: -10, max_pct: 10 });
const LIVE_PLAN = { ...PLAN, review: REVIEW, economic_factors: [factor('economic_trend', 'Economic trend'), factor('seasonality', 'Seasonal demand'), factor('competition', 'Competitor pricing moves')], drivers: [
  driver('risk_avoided', 'Losses avoided across every store and channel', 'AVOID RISK'), driver('time_saved', 'Analyst time saved on every review case', 'REDUCE COST'),
  driver('revenue_uplift', 'Customers kept after the first renewal', 'GROW REVENUE'), driver('cost_cut', 'Fees avoided on each outbound shipment', 'REDUCE COST'),
  driver('productivity', 'Team capacity freed for other planning work', 'REDUCE COST')] };
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

const measure = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[role=dialog]');
  const body = dlg.querySelector('[data-wizard-body]');
  const inView = (el) => { const r = el?.getBoundingClientRect(); return Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight); };
  const tick = [...dlg.querySelectorAll('input[type=checkbox]')].find((c) => /accept these terms/.test(c.closest('label')?.textContent || ''));
  const pg = dlg.querySelector('[data-wizard-page]')?.getAttribute('data-wizard-page');
  return { pg, scroll: body.scrollHeight, client: body.clientHeight, tick: inView(tick), save: inView(dlg.querySelector('[data-save-button]')), hasTick: Boolean(tick) };
});

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`W${width}: every wizard step fits ${width}x${height} with all 5 drivers on and the largest content`, async () => {
    const { ui, card, page } = await openCard(mountLive);
    try {
      await page.setViewportSize({ width, height });
      await card.getByRole('button', { name: 'Edit value' }).click();
      const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
      await dialog.waitFor();
      const seen = [];
      for (let i = 0; i < 12; i += 1) {
        await dialog.locator('[data-wizard-page]').first().waitFor();
        await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
        if (await dialog.locator('[data-wizard-page="save"]').count()) {
          await dialog.locator('[data-value-review]').waitFor({ timeout: 15000 });
          await page.waitForFunction(() => document.querySelectorAll('[data-history-row]').length === 2, null, { timeout: 15000 }).catch(() => {});
        }
        seen.push(await measure(page));
        if (seen[seen.length - 1].pg === 'save') break;
        await next(dialog);
      }
      for (const s of seen) console.log(`step ${s.pg} ${width}x${height}: scrollHeight ${s.scroll} clientHeight ${s.client}${s.pg === 'save' ? ` tick ${s.tick} save ${s.save}` : ''}`);
      const pages = seen.map((s) => s.pg);
      assert.ok(pages.includes('factors'), `factors step reached: ${pages}`);
      assert.equal(pages.filter((p) => p.startsWith('driver:')).length, 5, `5 driver pages: ${pages}`);
      assert.equal(pages[pages.length - 1], 'save');
      const bad = seen.filter((s) => s.scroll > s.client + 1).map((s) => `${s.pg}: ${s.scroll} > ${s.client}`);
      assert.deepEqual(bad, [], `steps that scroll at ${width}x${height}`);
      const last = seen[seen.length - 1];
      assert.equal(last.tick, true, 'tick in view');
      assert.equal(last.save, true, 'Accept and save in view');
    } finally { await ui.close(); }
  });
}
