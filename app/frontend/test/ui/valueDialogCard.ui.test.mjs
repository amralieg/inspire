// REQ-449/450/451 (W16 D21-D24): the Calculate dialog shows whole counts, formatted money, a stable frame and no write of $0.
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
    await goTo(dialog, 'data');
    const figure = dialog.locator('[data-records-per-year]');
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
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    assert.match(await flat(dialog.locator('[data-preview-state]')), /^Calculating\.\.\.$/);
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.match(await flat(dialog.locator('[data-preview-state]')), /^Up to date$/);
  } finally { await slow.ui.close(); }
  const failed = await openCard(mountWizard({ planReply: { status: 500, body: { error: 'no plan' } } }));
  try {
    const dialog = await openWizard(failed.page, failed.card);
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

test('D23: the dialog and its buttons stay put at every step, and group counts are whole', async () => {
  const { ui, card, page } = await openCard(mountWizard({ planReply: { plan: FRACTIONAL } }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    const boxes = [];
    const nextBtn = dialog.getByRole('button', { name: 'Next', exact: true });
    for (let i = 0; i < 12; i += 1) {
      const d = await dialog.boundingBox();
      const n = (await nextBtn.count()) ? await nextBtn.boundingBox() : null;
      boxes.push({ page: await dialog.locator('[data-wizard-page]').first().getAttribute('data-wizard-page'), y: d.y, h: d.height, w: d.width, ny: n?.y, nx: n?.x });
      if (await dialog.locator('[data-wizard-page="groups"]').count()) {
        assert.doesNotMatch(await flat(dialog.locator('[data-wizard-page="groups"]')), /\d\.\d+ a year/);
      }
      if (!(await nextBtn.count())) break;
      await next(dialog);
    }
    assert.ok(boxes.length >= 4, 'walked every step');
    for (const b of boxes) {
      assert.equal(b.y, boxes[0].y, `dialog top at ${b.page}`);
      assert.equal(b.h, boxes[0].h, `dialog height at ${b.page}`);
      assert.equal(b.w, boxes[0].w, `dialog width at ${b.page}`);
    }
    for (const b of boxes.filter((x) => x.ny !== undefined)) { assert.equal(b.ny, boxes[0].ny, `Next top at ${b.page}`); assert.equal(b.nx, boxes[0].nx, `Next left at ${b.page}`); }
  } finally { await ui.close(); }
});

test('D24: with no kind ticked Calculate now is off, says what to tick and writes nothing', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, planReply: { plan: ALL_OFF } }));
  try {
    const dialog = await openWizard(page, card);
    const calc = dialog.getByRole('button', { name: 'Calculate now', exact: true });
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    assert.equal(await calc.isDisabled(), true, 'disabled on the kinds page');
    assert.match(await flat(dialog), /Tick a kind of value/);
    assert.equal(puts.length, 0);
    await dialog.getByRole('checkbox').first().click();
    await calc.waitFor();
    assert.equal(await calc.isDisabled(), false);
    assert.equal(puts.length, 0, 'nothing is written until the user saves');
  } finally { await ui.close(); }
});
