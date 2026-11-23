// REQ-449 to REQ-453: the value dialog and value box UX. Save closes the dialog; the numbers move live with the slider; every number shows
// its unit; the refine banner is a short summary; the card keeps the rename pencil next to the name and the value box clear of text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { goTo, mountWizard, openCard, openWizard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

test('U1 (REQ-449): Save closes the dialog within 2 s and the card shows the saved value; a 500 shows its error inside the dialog', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:time_saved');
    await dialog.locator('[data-ask="cost_per_hour"] input[type=number]').fill('60');
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Accept and save', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 2000 });
    assert.equal(puts.length, 1);
    await card.locator('[data-value-yearly] [data-value-amount]').waitFor({ timeout: 5000 });
    assert.match(await text(card.locator('[data-value-yearly] [data-value-qualifier]')), /Reviewed calculation/);
  } finally { await ui.close(); }
  const failing = await openCard(mountWizard({ putReply: { status: 500, body: { error: 'The warehouse refused the write.' } } }));
  try {
    const dialog = await openWizard(failing.page, failing.card);
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Accept and save', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'The warehouse refused the write.' }).waitFor({ timeout: 5000 });
    assert.equal(await dialog.isVisible(), true, 'a failed save keeps the dialog open');
  } finally { await failing.ui.close(); }
});

test('U2 (REQ-450): the number follows the slider on input, before any change event', async () => {
  const { ui, card, page } = await openCard(mountWizard({ previewDelay: 800 }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:risk_avoided');
    const ask = dialog.locator('[data-ask="reduction_pct"]');
    const slider = ask.locator('input[type=range]');
    await slider.evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '37');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.match(await text(ask.locator('[data-live-value]')), /^37\b/, 'the live number shows 37 at once');
    assert.equal(await ask.locator('input[type=number]').inputValue(), '37');
    await slider.focus();
    await slider.press('ArrowRight');
    assert.match(await text(ask.locator('[data-live-value]')), /^38\b/, 'one ArrowRight moves the live number');
  } finally { await ui.close(); }
});

test('U2b (REQ-450): the amount refreshes while the slider is still moving, not only after it stops', async () => {
  const previews = [];
  const { ui, card, page } = await openCard(mountWizard({ previews }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:risk_avoided');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    const before = previews.length;
    const slider = dialog.locator('[data-ask="reduction_pct"] input[type=range]');
    // A drag: one input event every 50 ms for 1 s, no change event. A debounce sends nothing until it stops.
    const during = await slider.evaluate(async (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (let v = 10; v < 30; v += 1) { set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 50)); }
      return true;
    });
    assert.ok(during);
    assert.ok(previews.length - before >= 3, `at least 3 preview requests during a 1 s drag, got ${previews.length - before}`);
  } finally { await ui.close(); }
});

test('U3 (REQ-451): every ask and the result lines show their unit', async () => {
  const { ui, card, page } = await openCard(mountWizard());
  try {
    const dialog = await openWizard(page, card);
    const UNIT = { money: /USD|\$/, pct: /%/, hours: /hours/, count: /per year|people|records/ };
    const kindOf = { incidents_per_year: 'count', cost_per_incident: 'money', reduction_pct: 'pct', events_per_year: 'count', people: 'count',
      hours_before: 'hours', hours_after: 'hours', cost_per_hour: 'money', base_revenue_per_year: 'money', uplift_pct: 'pct' };
    for (const driver of ['risk_avoided', 'time_saved', 'revenue_uplift']) {
      await goTo(dialog, `driver:${driver}`);
      await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
      for (const el of await dialog.locator('[data-ask]').all()) {
        const id = await el.getAttribute('data-ask');
        const own = await text(el.locator('[data-unit], [data-from-data]').first());
        assert.match(own, UNIT[kindOf[id]], `${id} shows its unit, got "${own}"`);
      }
      assert.match(await text(dialog.locator('[data-kind-amount]')), /\$.*per year/, 'the kind amount names its currency and period');
      assert.match(await text(dialog.locator('[data-run-total]')), /\$.*per year/, 'the running total names its currency and period');
    }
  } finally { await ui.close(); }
});

const usd = (amount) => ({ verb: 'AVOID RISK', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }] });
const many = (n = 31) => {
  const out = structuredClone(REVIEW_RESULTS);
  const base = out.domains[0].use_cases[0];
  out.domains = [{ ...out.domains[0], use_cases: Array.from({ length: n }, (_, i) => ({ ...base, No: `N09-U${String(i).padStart(2, '0')}`, Name: `Refine case ${i}`, use_case: `Refine case ${i}`,
    user_use_case_name: `Refine case ${i}`, inspire_score: '8.39', best_of_best: 'N', meets_quality_bar: 'Y' })) }];
  return out;
};

test('U4 (REQ-452): with 30 refine pairs the banner shows at most 3 lines and a more control, and no use case twice', async () => {
  const results = many();
  const yearly = Object.fromEntries(results.domains[0].use_cases.map((u, i) => [u.No, usd(i === 0 ? 25.61e6 : 638.96e6)]));
  const mount = (app) => {
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: yearly }));
    mountWizard()(app);
  };
  const ui = await openUi('results', { ...REVIEW_STATE, results }, '', { mount });
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.waitFor({ timeout: 20000 });
    const lines = await banner.locator('li').count();
    assert.ok(lines >= 1 && lines <= 3, `at most 3 lines, got ${lines}`);
    assert.equal(await banner.getByRole('button', { name: /more/i }).count(), 1, 'one control shows the rest');
    const names = (await text(banner)).match(/Refine case \d+\b/g) || [];
    assert.equal(new Set(names).size, names.length, `no use case twice: ${names.join(', ')}`);
  } finally { await ui.close(); }
});

const ARABIC = 'التنبؤ بانسحاب العملاء';
const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
for (const [width, rtl] of [[1280, false], [1280, true], [390, false], [390, true]]) {
  test(`U5 (REQ-453): at ${width} px ${rtl ? 'right to left' : 'left to right'} the pencil follows the name and the value box overlaps no text`, async () => {
    const results = structuredClone(REVIEW_RESULTS);
    if (rtl) for (const d of results.domains) for (const u of d.use_cases) if (u.No === 'N01-U01') { u.Name = ARABIC; u.use_case = ARABIC; u.user_use_case_name = ARABIC; }
    const mount = (app) => {
      app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': { ...usd(620000), stale: true, total: { unit: 'USD', amount: 620000 } } } }));
      mountWizard()(app);
    };
    const ui = await openUi('results', { ...REVIEW_STATE, results }, '', { mount });
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height: 800 });
      if (rtl) await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
      const card = page.locator('[data-use-case-no="N01-U01"]');
      await card.locator('[data-value-yearly]').waitFor({ timeout: 15000 });
      await idle(page);
      const m = await card.evaluate((root, isRtl) => {
        const rectOf = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
        const h3 = root.querySelector('h3');
        const range = document.createRange();
        range.selectNodeContents(h3);
        const lines = [...range.getClientRects()];
        const lastLine = lines.sort((a, b) => a.bottom - b.bottom || (isRtl ? b.left - a.left : a.right - b.right)).at(-1);
        const nameEnd = isRtl ? lastLine.left : lastLine.right;
        const pencil = root.querySelector('button[aria-label^="Rename"]');
        const box = root.querySelector('[data-value-yearly]');
        const header = h3.closest('[role="button"]');
        const texts = [...header.querySelectorAll('h3, p, span, bdi, div')].filter((el) => !box.contains(el) && el.children.length === 0 && el.textContent.trim()).map(rectOf);
        const boxParts = [box, ...box.querySelectorAll('[data-value-tag], [data-value-edit], [data-value-verb], [data-value-amount]')].map(rectOf);
        return { nameEnd, pencil: rectOf(pencil), boxParts, texts, name: rectOf(h3) };
      }, rtl);
      const gap = rtl ? m.nameEnd - m.pencil.r : m.pencil.l - m.nameEnd;
      assert.ok(gap >= -1 && gap <= 16, `the pencil starts ${gap}px after the name text (limit 16)`);
      for (const part of m.boxParts) {
        assert.ok(!hit(part, m.pencil), 'the value box and its badge never cover the pencil');
        for (const t of m.texts) assert.ok(!hit(part, t), `the value box covers text at ${JSON.stringify(t)}`);
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally { await ui.close(); }
  });
}
