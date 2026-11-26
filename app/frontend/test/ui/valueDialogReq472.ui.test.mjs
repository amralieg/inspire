// REQ-472 (d, e), REQ-473, REQ-474, REQ-507: the Calculate value dialog: kinds with Include, a title with the use case name, no By group,
// no old measure questions, the model review line, and the likely value and the old economic trend as a factor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, stubMoney } from './uiSupport.mjs';
import { PLAN, goTo, mountWizard, next, openCard, saveFrom, sleep } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const TITLE = /^Calculating Value at Stake for Predict churn$/;
async function open(page, card) {
  await card.locator('[data-value-calculate]').waitFor({ timeout: 15000 });
  await card.locator('[data-value-calculate]').click();
  const dialog = page.getByRole('dialog', { name: TITLE });
  await dialog.waitFor();
  return dialog;
}
const STEPS = ['Data', 'Kinds', 'Each kind', 'Value story', 'Terms and accept'];
// Every page from the current one to terms, the last page with a Next button (the Save page only follows the approval).
const pagesOf = async (dialog) => {
  const seen = [];
  for (let i = 0; i < 24; i += 1) {
    await dialog.locator('[data-wizard-page]').first().waitFor();
    seen.push(await dialog.locator('[data-wizard-page]').first().getAttribute('data-wizard-page'));
    if (seen.at(-1) === 'terms') break;
    await next(dialog);
  }
  return seen;
};
const TREND = { likely: 'mild', options: [{ id: 'none', label: 'Flat', pct: 0, why: 'No change expected.' }, { id: 'mild', label: 'Mild growth', pct: 3, why: 'Demand follows the economy.' }] };

test('D1: the dialog title reads "Calculating Value at Stake for <the use case name>"', async () => {
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    const dialog = await open(page, card);
    assert.match(await text(dialog.locator('#calculate-value-title')), TITLE);
  } finally { await ui.close(); }
});

test('D2: the first page lists every factor with an Include checkbox; unticking one drops its page; no By group step', async () => {
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    const dialog = await open(page, card);
    await goTo(dialog, 'kinds');
    const boxes = dialog.getByRole('checkbox', { name: /^Include/ });
    assert.equal(await boxes.count(), PLAN.drivers.length);
    assert.equal(await dialog.locator('input[type=checkbox]').first().isChecked(), true, 'a factor the plan has on starts included');
    assert.deepEqual((await dialog.locator('ol[aria-label="Steps"] li').allInnerTexts()).map((t) => t.replace(/^[\d✓]+\s*/, '').trim()), STEPS);
    assert.doesNotMatch(await text(dialog.locator('ol[aria-label="Steps"]')), /By group/);
    const before = await pagesOf(dialog);
    assert.ok(before.includes('driver:risk_avoided'));
    assert.ok(!before.includes('groups'), 'no groups page');
    for (let i = 0; i < 24 && !(await dialog.locator('[data-wizard-page="kinds"]').count()); i += 1) await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('checkbox', { name: `Include ${PLAN.drivers[0].label}` }).uncheck();
    assert.ok(!(await pagesOf(dialog)).includes('driver:risk_avoided'), 'the unticked factor has no Each value page');
  } finally { await ui.close(); }
});

test('D3: case-plan is requested exactly once, with no group_by, and the page offers no grouping choice', async () => {
  const plans = [];
  const { ui, card, page } = await openCard(mountWizard({ plans }));
  try {
    const dialog = await open(page, card);
    await goTo(dialog, 'kinds');
    await pagesOf(dialog);
    await sleep(300);
    assert.equal(plans.length, 1);
    assert.equal('group_by' in plans[0], false);
    assert.equal(await dialog.getByRole('radiogroup', { name: 'Grouping' }).count(), 0);
  } finally { await ui.close(); }
});

test('D4: the old questions are gone from the dialog and from the Build wizard Measure section', async () => {
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    const dialog = await open(page, card);
    await goTo(dialog, 'kinds');
    await pagesOf(dialog);
    const all = await text(dialog);
    assert.doesNotMatch(all, /How does your business measure the value of each record\?/);
    assert.doesNotMatch(all, /Which movement counts\?/);
  } finally { await ui.close(); }
  const wiz = await openUi('wizard', { me: { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' } }, '', { init: (p) => stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(p) });
  try {
    await goToStep(wiz.page, 'Measure');
    for (let i = 0; i < 8 && await wiz.page.locator('[data-money-next]').count(); i += 1) await wiz.page.locator('[data-money-next]').click();
    const body = await wiz.page.locator('body').innerText();
    assert.doesNotMatch(body, /How does your business measure the value of each record\?/);
    assert.doesNotMatch(body, /Which movement counts\?/);
    assert.equal(await wiz.page.locator('[data-money-part="method"], [data-money-part="direction"], [data-money-part="sign"]').count(), 0);
  } finally { await wiz.close(); }
});

test('D5: a plan review shows "Reviewed by Databricks AI: <reason>" or "Not approved by a model review" on the Kinds page and the Save page', async () => {
  for (const [review, expected] of [[{ approved: true, model: 'm1', reason: 'fits' }, /Reviewed by Databricks AI: fits/], [{ approved: false, model: 'm1', reason: 'too high' }, /Not approved by a model review: too high\. Saved as an estimate\./]]) {
    const { ui, card, page } = await openCard(mountWizard({ planReply: { plan: { ...PLAN, review } } }));
    try {
      const dialog = await open(page, card);
      await goTo(dialog, 'kinds');
      assert.match(await text(dialog.locator('[data-value-review]')), expected);
      await pagesOf(dialog);
      await saveFrom(dialog);
      assert.match(await text(dialog.locator('[data-value-review]')), expected);
    } finally { await ui.close(); }
  }
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    const dialog = await open(page, card);
    await goTo(dialog, 'kinds');
    assert.equal(await dialog.locator('[data-value-review]').count(), 0, 'no review field, no line');
  } finally { await ui.close(); }
});

test('D6: Likely value shows on the Kinds page; an old stored Economic trend reads as one factor, unticked, and ticking it sends it; null shows neither', async () => {
  const previews = [];
  const plan = { ...PLAN, economic_trend: TREND, likely_value: { amount: 250000, currency: 'USD', reason: 'fits the volume' } };
  const { ui, card, page } = await openCard(mountWizard({ previews, planReply: { plan } }));
  try {
    const dialog = await open(page, card);
    await goTo(dialog, 'kinds');
    assert.match(await text(dialog.locator('[data-likely-value]')), /Likely value \(AI\): .*250K.*, fits the volume/);
    await goTo(dialog, 'factors');
    const factors = dialog.locator('[data-factor]');
    assert.equal(await factors.count(), 1, 'the old trend is one factor');
    assert.match(await text(factors.first()), /Economic trend.*Demand follows the economy/);
    const include = factors.first().getByRole('checkbox', { name: /Include/ });
    assert.equal(await include.isChecked(), false);
    assert.equal(await dialog.locator('[data-economic-trend]').count(), 0, 'no separate trend section');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    previews.length = 0;
    await include.check();
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await sleep(400);
    assert.deepEqual(previews.at(-1).answers.economic_factors.economic_trend, { on: true, pct: 3 });
  } finally { await ui.close(); }
  for (const none of [{ ...PLAN, economic_trend: null }, PLAN]) {
    const one = await openCard(mountWizard({ planReply: { plan: none } }));
    try {
      const dialog = await open(one.page, one.card);
      await goTo(dialog, 'kinds');
      assert.equal(await dialog.locator('[data-economic-trend]').count(), 0);
      assert.equal(await dialog.locator('[data-likely-value]').count(), 0);
      assert.equal(await dialog.getByText('Economic trend').count(), 0);
    } finally { await one.ui.close(); }
  }
});
