// REQ-436, REQ-437, REQ-507: the Calculate value wizard (8 steps: Data, Filter, Kinds, Each value, Ramp and cost, Market data, Story, Save).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { dragTo, FALLBACK_PLAN, goTo, mountWizard, next, openCard, openWizard, saveFrom, sleep, watchPreviewStates } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

test('W1: the wizard reads the records first, calls case-plan once after the Filter step, and the kind pages show the case noun and the records a year', async () => {
  const plans = [];
  const { ui, card, page } = await openCard(mountWizard({ plans }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    assert.equal(plans.length, 0, 'no case plan before the Filter step is left');
    assert.match(await text(dialog.locator('[data-scope-facts]')), /review cases/);
    await goTo(dialog, 'kinds');
    await goTo(dialog, 'driver:time_saved');
    assert.equal(plans.length, 1);
    assert.equal(plans[0].use_case_id, 'N01-U01');
    assert.match(await text(dialog.locator('[data-ask="events_per_year"]')), /Cases a year/);
    assert.match(await text(dialog.locator('[data-ask="events_per_year"] [data-from-data]')), /12,000/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('W2: on a kind page a slider moves the number box, one preview follows the debounce, and the amount takes the reply; typing moves the slider', async () => {
  const previews = [];
  const { ui, card, page } = await openCard(mountWizard({ previews }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:risk_avoided');
    const ask = dialog.locator('[data-ask="reduction_pct"]');
    const slider = ask.locator('input[type=range]');
    const box = ask.locator('input[type=number]');
    await slider.waitFor();
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    previews.length = 0;
    const before = await text(dialog.locator('[data-kind-amount]'));
    // FX-43: record the states before the drag; a runner starved for 1.5 s still sees 'updating' and then 'ready'.
    const sawUpdatingThenReady = await watchPreviewStates(dialog);
    await dragTo(slider, 40);
    await sleep(1500);
    assert.equal(await box.inputValue(), '40');
    await sawUpdatingThenReady();
    await sleep(400);
    assert.equal(previews.length, 1, 'one preview for one move');
    assert.equal(previews[0].answers.drivers.risk_avoided.inputs.reduction_pct, 40);
    assert.notEqual(await text(dialog.locator('[data-kind-amount]')), before);
    assert.match(await text(dialog.locator('[data-run-total]')), /\$/);
    await box.fill('25');
    assert.equal(await slider.inputValue(), '25');
    await goTo(dialog, 'driver:time_saved');
    const people = dialog.locator('[data-ask="people"]');
    await people.locator('input[type=number]').fill('250');
    assert.equal(await people.locator('input[type=number]').inputValue(), '250', 'a typed value above the range is kept');
    assert.equal(Number(await people.locator('input[type=range]').getAttribute('max')) >= 250, true, 'the slider grows to the typed value');
    const a = await people.locator('input[type=range]').boundingBox();
    const b = await people.locator('input[type=number]').boundingBox();
    assert.ok(Math.abs(a.width - b.width) <= 1, `slider ${a.width} and box ${b.width} share one width`);
    assert.ok(await people.locator('[data-from-data]').count() === 0, 'an estimate ask is not marked from data');
    assert.ok(await dialog.locator('[data-ask="events_per_year"] [data-from-data]').count() === 1, 'a data ask is marked from your data');
  } finally { await ui.close(); }
});

test('W3: unticking a kind on the Kinds page previews without it, and the Terms page lists the ticked kinds with the total above and no tiles or editor', async () => {
  const previews = [];
  const { ui, card, page } = await openCard(mountWizard({ previews }));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'terms');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    const before = await text(dialog.locator('[data-save-total]'));
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    for (let i = 0; i < 6 && !(await dialog.locator('[data-wizard-page="kinds"]').count()); i += 1) {
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await sleep(200);
    }
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    previews.length = 0;
    await dialog.getByLabel('Include Losses avoided').uncheck();
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await sleep(400);
    assert.equal(previews.length, 1, 'one preview for one untick');
    assert.equal(previews[0].answers.drivers.risk_avoided.on, false);
    await goTo(dialog, 'terms');
    const total = dialog.locator('[data-save-total]');
    const summary = dialog.locator('[data-accept-summary]');
    assert.notEqual(await text(total), before, 'the total changed');
    // One frame for both boxes: read one by one, a box moving with the page transition lands on another frame.
    const { t, s } = await dialog.evaluate((d) => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { y: b.y, height: b.height }; };
      return { t: r(d.querySelector('[data-save-total]')), s: r(d.querySelector('[data-accept-summary]')) };
    });
    assert.ok(t.y + t.height <= s.y + 1, 'total is above the summary');
    const rows = summary.locator('[data-kind-amount-row]');
    const ids = await rows.evaluateAll((n) => n.map((x) => x.getAttribute('data-kind-amount-row')));
    assert.ok(ids.length > 0 && !ids.includes('risk_avoided'), `one row per ticked kind, risk_avoided absent: ${ids}`);
    for (const row of await rows.all()) assert.match(await text(row), /\$[\d.,]+\w* a year/);
    assert.equal(await summary.locator('input[type=checkbox]').count(), 0, 'no checkbox in the summary');
    assert.equal(await summary.locator('[data-editor]').count(), 0, 'no editor in the summary');
    assert.equal(await dialog.locator('input[type=checkbox]:not([data-value-accept])').count(), 1, 'the only other checkbox is the include-in-docs tick, no kind tick');
    assert.equal(await dialog.getByLabel('Include this story in generated docs').count(), 1);
    assert.equal(await dialog.locator('[data-value-accept]').count(), 1);
    assert.equal(await dialog.locator('[data-tile]').count(), 0, 'no tiles on the terms page');
    assert.equal(await dialog.locator('[data-editor]').count(), 0, 'no editor on the terms page');
  } finally { await ui.close(); }
});

test('W4: Accept and save sends PUT shape 2 with calculated true and the box label changes from estimated to calculated', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'terms');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 0, 'nothing is written before the approval');
    assert.equal(await dialog.getByRole('button', { name: 'Accept and save' }).isDisabled(), true, 'the terms are not accepted yet');
    await saveFrom(dialog);
    assert.match(await text(dialog.locator('[data-save-total]')), /Reviewed calculation/);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    await card.locator('[data-value-qualifier]').getByText('Reviewed calculation').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].use_case_id, 'N01-U01');
    assert.equal(puts[0].answers.shape, 2);
    assert.equal(puts[0].answers.calculated, true);
    assert.equal(puts[0].answers.attribution_pct, 60, 'REQ-507: the default share caused by the use case is 60 (SHARE_DEFAULT, lib/valueWizard.js)');
    assert.equal(puts[0].answers.plan.case_noun, 'review case');
    assert.equal(puts[0].answers.drivers.time_saved.on, true);
    assert.equal(puts[0].answers.drivers.cost_cut.on, false);
  } finally { await ui.close(); }
});

test('W5: a plan with no model shows the fallback notice, and a case-plan 500 shows Retry', async () => {
  const first = await openCard(mountWizard({ planReply: { plan: FALLBACK_PLAN } }));
  try {
    const dialog = await openWizard(first.page, first.card);
    await goTo(dialog, 'kinds');
    await dialog.getByText('Inspire could not read the data for this; the numbers are estimates you can change').waitFor({ timeout: 15000 });
  } finally { await first.ui.close(); }
  const plans = [];
  const { ui, card, page } = await openCard(mountWizard({ plans, planReply: { status: 500, body: { error: 'boom' } } }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'kinds');
    const retry = dialog.getByRole('button', { name: 'Retry' });
    await retry.waitFor({ timeout: 15000 });
    await retry.click();
    await dialog.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 15000 });
    assert.equal(plans.length, 2, 'Retry asks again');
  } finally { await ui.close(); }
});

test('W6: the Data, Kinds and Save steps fit a 1280x800 window with no scroll', async () => {
  const { ui, card, page } = await openCard(mountWizard());
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openWizard(page, card);
    for (const step of ['scope:facts', 'kinds', 'save']) {
      if (step === 'save') { await goTo(dialog, 'terms'); await saveFrom(dialog); } else await goTo(dialog, step);
      await dialog.locator('[data-preview-state="ready"], [data-wizard-page="scope:facts"], [data-wizard-page="kinds"]').first().waitFor({ timeout: 15000 });
      const fit = await page.evaluate(() => {
        const dlg = document.querySelector('[role=dialog]');
        const body = dlg.querySelector('[data-wizard-page]').parentElement;
        const scroller = [dlg, ...dlg.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
        const r = dlg.getBoundingClientRect();
        return { page: r.top < 0 || r.left < 0 || r.right > window.innerWidth || dlg.scrollWidth > dlg.clientWidth + 1,
          inner: Boolean(scroller), bottom: dlg.getBoundingClientRect().bottom, bodyOver: body.scrollHeight > body.clientHeight + 1 };
      });
      assert.deepEqual({ step, ...fit, bottom: fit.bottom <= 800 }, { step, page: false, inner: false, bottom: true, bodyOver: false });
    }
  } finally { await ui.close(); }
});
