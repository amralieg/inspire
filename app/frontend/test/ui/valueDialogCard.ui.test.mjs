// REQ-449/450/451 (W16 D21-D24), REQ-507: the Calculate dialog shows whole counts, formatted money, a stable frame and no write of $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, goTo, mountWizard, next, openCard, openWizard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const flat = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const ALL_OFF = { ...PLAN, model: null, drivers: PLAN.drivers.map((d) => ({ ...d, on: false })) };
const FRACTIONAL = { ...PLAN, groups: [
  { g: 'North', records_per_year: 12581.76, metrics: { amt: 400 } },
  { g: 'South', records_per_year: 58979.7, metrics: { amt: 300 } },
] };

test('D21: a record count is a whole number', async () => {
  const { ui, card, page } = await openCard(mountWizard({ planReply: { plan: FRACTIONAL } }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    const figure = dialog.locator('[data-ask="events_per_year"] [data-from-data]');
    await figure.waitFor({ timeout: 15000 });
    const t = await flat(figure);
    assert.match(t, /71,56[12]/);
    assert.doesNotMatch(t, /\d\.\d/, 'no fractional count');
  } finally { await ui.close(); }
});

test('D21: the footer says Calculating until a value exists, never Up to date', async () => {
  const slow = await openCard(mountWizard({ previewDelay: 2500 }));
  try {
    const dialog = await openWizard(slow.page, slow.card);
    await goTo(dialog, 'kinds');
    assert.match(await flat(dialog.locator('[data-preview-state]')), /^Calculating\.\.\.$/);
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.match(await flat(dialog.locator('[data-preview-state]')), /^Up to date$/);
  } finally { await slow.ui.close(); }
  const failed = await openCard(mountWizard({ planReply: { status: 500, body: { error: 'no plan' } } }));
  try {
    const dialog = await openWizard(failed.page, failed.card);
    await goTo(dialog, 'kinds');
    await dialog.getByRole('alert').first().waitFor({ timeout: 15000 });
    assert.doesNotMatch(await flat(dialog.locator('[data-preview-state]')), /Up to date/);
  } finally { await failed.ui.close(); }
});

test('D22: money is formatted, an implausible uplift is noted and the slider range stays stable', async () => {
  const { ui, card, page } = await openCard(mountWizard());
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:revenue_uplift');
    const revenue = dialog.locator('[data-ask="base_revenue_per_year"]');
    await revenue.locator('input[type=number]').fill('5000000');
    assert.match(await flat(revenue.locator('[data-live-value]')), /5,000,000 USD per year/);
    const max = Number(await revenue.locator('input[type=range]').getAttribute('max'));
    assert.ok(max > 5000000, `slider max ${max} leaves headroom above the typed value`);
    const uplift = dialog.locator('[data-ask="uplift_pct"]');
    assert.equal(await uplift.locator('[data-plausibility]').count(), 0, 'no note at the default');
    await uplift.locator('input[type=number]').fill('62');
    await uplift.locator('[data-plausibility]').waitFor({ timeout: 5000 });
  } finally { await ui.close(); }
});

test('D23: the dialog and its buttons stay put at every step, and the counts from your data are whole', async () => {
  const { ui, card, page } = await openCard(mountWizard({ planReply: { plan: FRACTIONAL } }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    const boxes = [];
    const nextBtn = dialog.getByRole('button', { name: 'Next', exact: true });
    for (let i = 0; i < 24; i += 1) {
      // Settle: the same box twice, 150 ms apart (the dialog's open animation and the page fade end).
      for (let k = 0, last = ''; k < 20; k += 1) { const now = JSON.stringify(await dialog.boundingBox()); if (now === last) break; last = now; await new Promise((r) => setTimeout(r, 150)); }
      const d = await dialog.boundingBox();
      const n = (await nextBtn.count()) ? await nextBtn.boundingBox() : null;
      const pg = await dialog.locator('[data-wizard-page]').first().getAttribute('data-wizard-page');
      boxes.push({ page: pg, y: d.y, h: d.height, w: d.width, ny: n?.y, nx: n?.x });
      if (pg.startsWith('driver:')) {
        for (const t of await dialog.locator('[data-ask="events_per_year"] [data-from-data]').allInnerTexts()) assert.doesNotMatch(t.replace(/\s+/g, ' '), /\d\.\d+/, `whole count at ${pg}`);
      }
      if (!(await nextBtn.count())) break;
      await next(dialog);
    }
    assert.deepEqual(boxes.map((b) => b.page), ['scope:facts', 'scope:choice', 'filter', 'kinds', 'driver:risk_avoided', 'driver:time_saved', 'driver:revenue_uplift',
      'economics:ramp', 'economics:cost', 'story:draft', 'story:params', 'story:approve'], 'walked every step');
    for (const b of boxes) {
      assert.equal(b.y, boxes[0].y, `dialog top at ${b.page}: ${JSON.stringify(boxes)}`);
      assert.equal(b.h, boxes[0].h, `dialog height at ${b.page}`);
      assert.equal(b.w, boxes[0].w, `dialog width at ${b.page}`);
    }
    for (const b of boxes.filter((x) => x.ny !== undefined)) { assert.equal(b.ny, boxes[0].ny, `Next top at ${b.page}`); assert.equal(b.nx, boxes[0].nx, `Next left at ${b.page}`); }
  } finally { await ui.close(); }
});

test('D24: with no kind ticked Next is off, says what to tick and writes nothing; ticking one turns it on, unticking it turns it off again', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, planReply: { plan: ALL_OFF } }));
  try {
    const dialog = await openWizard(page, card);
    const nextBtn = dialog.getByRole('button', { name: 'Next', exact: true });
    await goTo(dialog, 'kinds');
    assert.equal(await nextBtn.isDisabled(), true, 'disabled on the kinds page');
    assert.match(await flat(dialog), /Tick a kind of value/);
    assert.equal(puts.length, 0);
    await dialog.getByRole('checkbox').first().click();
    await nextBtn.waitFor();
    assert.equal(await nextBtn.isDisabled(), false);
    assert.equal(puts.length, 0, 'nothing is written until the user approves');
    // Step on to the Ramp page, back to the kinds, untick the kind again: Next is off there too.
    await goTo(dialog, 'economics:ramp');
    assert.equal(puts.length, 0);
    const back = dialog.getByRole('button', { name: 'Back', exact: true });
    for (let i = 0; i < 6 && !(await dialog.locator('[data-wizard-page="kinds"]').count()); i += 1) await back.click();
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    await dialog.getByRole('checkbox').first().click();
    assert.equal(await nextBtn.isDisabled(), true, 'disabled on the kinds page again');
    assert.match(await flat(dialog), /Tick a kind of value/);
    assert.equal(puts.length, 0);
  } finally { await ui.close(); }
});
