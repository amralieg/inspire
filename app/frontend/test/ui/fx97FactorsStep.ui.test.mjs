// FX-97 (REQ-493, REQ-494): the "Market and customer factors" step: only for a plan with a revenue kind, a card per factor with an Include box,
// a slider within its bounds and a visual, a total effect bar, and the old economic trend block is gone from step 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, mountWizard, openCard, openWizard, goTo, dragTo, fakeYearly, sleep } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const FACTORS = [
  { id: 'confidence', label: 'Consumer confidence', why: 'Shoppers spend more when they feel secure.', likely_pct: 4, min_pct: -10, max_pct: 15 },
  { id: 'satisfaction', label: 'Customer satisfaction', why: 'Happy customers come back.', likely_pct: 2, min_pct: -5, max_pct: 8 },
];
const COST_ONLY = { ...PLAN, drivers: PLAN.drivers.filter((d) => d.verb !== 'GROW REVENUE') };
const TREND = { likely: 'mild', options: [{ id: 'none', label: 'Flat', pct: 0, why: 'No change.' }, { id: 'mild', label: 'Mild growth', pct: 3, why: 'Demand follows the economy.' }] };

// The mount of a wizard whose case-plan reply is `plan`; the preview fakes the server's math: each ticked factor adds its pct of the revenue part.
const mountWith = (plan, previews = []) => (app) => {
  app.post('/api/inspire/value/case-plan', (_req, res) => res.json({ plan }));
  app.post('/api/inspire/value/preview', (req, res) => {
    previews.push(req.body);
    const y = fakeYearly(req.body);
    const rev = y.parts.find((p) => p.id === 'revenue_uplift');
    const extra = Object.values(req.body.answers.economic_factors || {}).filter((f) => f.on).reduce((s, f) => s + (rev ? (rev.amount * f.pct) / 100 : 0), 0);
    res.json({ yearly: { ...y, total: { ...y.total, amount: y.total.amount + extra } } });
  });
  mountWizard({})(app);
};
const totalOf = async (dialog) => (await dialog.locator('[data-factors-total]').innerText()).replace(/\s+/g, ' ').trim();

test('X1: the step shows for a revenue plan with a card, Include box, slider and bar per factor, and a slider changes the total', async () => {
  const previews = [];
  const run = await openCard(mountWith({ ...PLAN, economic_factors: FACTORS }, previews));
  try {
    const dialog = await openWizard(run.page, run.card);
    await goTo(dialog, 'factors');
    assert.match(await dialog.locator('[data-wizard-page="factors"]').innerText(), /Market and customer factors/);
    const cards = dialog.locator('[data-factor]');
    assert.equal(await cards.count(), 2);
    const first = cards.first();
    assert.match(await first.innerText(), /Consumer confidence[\s\S]*Shoppers spend more/);
    await first.locator('[data-factor-bar]').waitFor();
    const slider = first.getByRole('slider');
    assert.equal(await slider.getAttribute('min'), '-10');
    assert.equal(await slider.getAttribute('max'), '15');
    await first.getByRole('checkbox', { name: /Include/ }).check();
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await sleep(400);
    const before = await totalOf(dialog);
    await dragTo(slider, 12);
    await sleep(600);
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.notEqual(await totalOf(dialog), before, 'the slider moves the number');
    assert.deepEqual(previews.at(-1).answers.economic_factors.confidence, { on: true, pct: 12 });
  } finally { await run.ui.close(); }
});

test('X2: a cost-only plan has no factors step even when the plan lists factors', async () => {
  const { ui, card, page } = await openCard(mountWith({ ...COST_ONLY, economic_factors: FACTORS }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'kinds');
    const seen = [];
    for (let i = 0; i < 24; i += 1) {
      seen.push(await dialog.locator('[data-wizard-page]').first().getAttribute('data-wizard-page'));
      if (seen.at(-1) === 'story:approve') break;
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    }
    assert.equal(seen.at(-1), 'story:approve', seen.join());
    assert.ok(!seen.includes('factors'), seen.join());
  } finally { await ui.close(); }
});

test('X3: step 1 no longer carries the economic trend block, and an old stored trend shows as one factor on the new step', async () => {
  const { ui, card, page } = await openCard(mountWith({ ...PLAN, economic_trend: TREND }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'kinds');
    assert.equal(await dialog.locator('[data-economic-trend]').count(), 0);
    await goTo(dialog, 'factors');
    assert.equal(await dialog.locator('[data-factor]').count(), 1);
  } finally { await ui.close(); }
});
