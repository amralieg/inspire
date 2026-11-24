// FX-38b (REQ-453, W16 D25, D26, D35, D36, D24 remainder): the use case card's value note, the dialog's return to the card,
// the Build next row at 390, the initial theme, and the saved value replacing the old estimate text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, setDark, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { goTo } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const REASON = 'Check the numbers: $638.96M a year is above $100M, the top of the usual range for one use case.';
const YEARLY = (amount, extra = {}) => ({ verb: 'AVOID RISK', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }],
  basis: { sampled_records: 1200, eligible_records: 48000, days: 90 }, ...extra });
const baseMount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/overall', (_req, res) => res.json({ at_stake: [], saved: [], runs: 0, businesses: 0 }));
  app.get('/api/inspire/value/runs', (_req, res) => res.json({ runs: {} }));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
};
const rect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; });
const touches = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

// D25
const SETUPS = [['1280 ltr light', 1280, 'ltr', false], ['1280 ltr dark', 1280, 'ltr', true], ['1280 rtl light', 1280, 'rtl', false],
  ['390 ltr light', 390, 'ltr', false], ['390 rtl dark', 390, 'rtl', true]];
for (const [name, width, dir, dark] of SETUPS) {
  test(`D25: the "Check the numbers" note overlaps nothing and stays whole at ${name}`, async () => {
    const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: (app) => {
      app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': YEARLY(638960000, { check: { outside: 'high', reason: REASON } }) } }));
      baseMount(app);
    } });
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((d) => { document.documentElement.dir = d; }, dir);
      await setDark(page, dark);
      const list = page.getByRole('region', { name: 'Use case list' });
      await list.locator('[data-use-case-row]').first().waitFor();
      const card = list.locator('[data-use-case-row]').filter({ hasText: 'Predict churn' });
      const note = card.locator('[data-value-check]');
      await note.waitFor({ timeout: 15000 });
      await page.waitForTimeout(700);
      const n = await rect(note);
      assert.deepEqual(await note.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'the note text fits its own pill');
      for (const part of ['[data-value-tag]', '[data-value-verb]', '[data-value-amount]', '[data-value-qualifier]', '[data-value-period]', '[data-score-box]', '[data-value-edit]']) {
        const other = await rect(card.locator(part).first());
        assert.equal(touches(n, other), false, `the note does not overlap ${part}`);
      }
      assert.ok(n.l >= 0 && n.r <= width, 'the note is on screen');
      const box = await rect(card.locator('[data-value-box]'));
      // Whole inside the red box, or whole below it (the tag overhangs the bottom edge by 10 px, so below means past it).
      const inside = n.l >= box.l - 0.5 && n.r <= box.r + 0.5 && n.t >= box.t - 0.5 && n.b <= box.b + 0.5;
      const below = n.t >= box.b - 0.5;
      assert.ok(inside || below, 'the note is inside the value box or fully below it, never straddling its edge');
      assert.deepEqual(ui.pageErrors, []);
    } finally { await ui.close(); }
  });
}

// D26 + D24 remainder
const PUTS = [];
const calcMount = (app) => {
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.put('/api/inspire/value/answers', (req, res) => { PUTS.push(req.body); res.json({ version: 1, yearly: YEARLY(405556), disclaimer: '' }); });
  baseMount(app);
};
const cardOf = (page, name) => page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').filter({ hasText: name });
async function openCalc(page, name) {
  const card = cardOf(page, name);
  await card.first().waitFor();
  await card.locator('[data-value-calculate]').click();
  const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
  await dialog.waitFor();
  return dialog;
}
// What the person sees over a card once its dialog is gone: nothing fixed or absolute covers it, and its header is not shaded.
const coverOf = (page, name) => page.evaluate((n) => {
  const rows = [...document.querySelectorAll('[data-use-case-row]')];
  const header = rows.find((el) => el.textContent.includes(n));
  const card = header;
  const r = card.getBoundingClientRect();
  const covers = [];
  for (const [fx, fy] of [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8], [0.3, 0.5], [0.7, 0.5]]) {
    const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
    if (top && !card.contains(top)) covers.push(`${top.tagName}.${String(top.className).slice(0, 60)}`);
  }
  const peer = rows.find((el) => el !== header && !el.hasAttribute('data-open'));
  return { covers, shade: getComputedStyle(header).backgroundColor, peerShade: peer ? getComputedStyle(peer).backgroundColor : null, dialogs: document.querySelectorAll('[role="dialog"]').length };
}, name);

test('D26: after Save no grey overlay stays on the card, focus is in the card, and the list stays where it was', async () => {
  PUTS.length = 0;
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: calcMount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 500 });
    const dialog = await openCalc(page, 'Predict churn');
    const before = await rect(cardOf(page, 'Predict churn'));
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Accept and save', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await cardOf(page, 'Predict churn').locator('[data-value-yearly]').waitFor({ timeout: 15000 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(800);
    const cover = await coverOf(page, 'Predict churn');
    assert.deepEqual(cover.covers, [], 'nothing outside the card is drawn over it');
    assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(cover.shade) || cover.shade === cover.peerShade, 'the row carries no leftover grey: it shows the same background as a row nothing touched');
    const inCard = await page.evaluate(() => {
      const a = document.activeElement;
      return Boolean(a && a.closest('[data-use-case-no], [data-use-case-card]') || a?.closest('[data-use-case-row]'));
    });
    assert.ok(inCard, 'focus returned to the card that was opened');
    const after = await rect(cardOf(page, 'Predict churn'));
    assert.ok(Math.abs(after.t - before.t) <= 60, `the card stays where it was (moved ${after.t - before.t} px)`);
  } finally { await ui.close(); }
});

test('D26: closing the dialog with X leaves the list where it was and focus on the card that was opened', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: calcMount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 500 });
    await cardOf(page, 'Score upsell').first().waitFor();
    await cardOf(page, 'Score upsell').scrollIntoViewIfNeeded();
    const dialog = await openCalc(page, 'Score upsell');
    const scrollBefore = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => e.scrollTop));
    const before = await rect(cardOf(page, 'Score upsell'));
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(500);
    const after = await rect(cardOf(page, 'Score upsell'));
    const scrollAfter = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => e.scrollTop));
    assert.ok(Math.abs(after.t - before.t) <= 60, `the card stays where it was (moved ${after.t - before.t} px; scroll ${scrollBefore} -> ${scrollAfter})`);
    const inCard = await page.evaluate(() => Boolean(document.activeElement?.closest('[data-use-case-row]')));
    assert.ok(inCard, 'focus is on the card that was opened');
    const cover = await coverOf(page, 'Score upsell');
    assert.deepEqual(cover.covers, []);
  } finally { await ui.close(); }
});

// D35: the Build next rows at 390
const LONG = (high) => JSON.stringify({ status: 'measured', value_low: high / 3, value_high: high, currency: 'USD',
  text: `USD ${high / 3} to ${high} a year (reporting currency USD (default)), if daily sales revenue rises 5-15% (measured: 5,646 USD Daily Sales Revenue in the last 1 days to the newest data, from totalprice in inspire_01.w1_bakehouse.sales_transactions; the percentages are an assumption)` });
const NAMES = ['Watch Franchise Demand Against Local Supply Shortfalls', 'Plan Daily Bake Volumes By Store And Weekday Pattern', 'Rank Franchises By Revenue Decline Cause And Season'];
const NEXT_CASES = NAMES.map((name, i) => ({ id: `N0${i + 1}-U01`, use_case: name, name_with_technique: name, primary_table: `main.s.t${i}`, tables_involved: `main.s.t${i}`,
  value_estimate: LONG(300000 - i * 1000), data_evidence: JSON.stringify({ tables: { [`main.s.t${i}`]: { columns: [] } } }), inspire_score: String(8 - i) }));
test('D35: at 390 a Build next title wraps whole, the value is one short line, and the button does not squeeze the title', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE, useCases: NEXT_CASES, history: [] }, '', { mount: (app) => { app.get('/api/defaults', (_req, res) => res.json(DEFAULTS)); app.get('/api/showcase', (_req, res) => res.json({})); } });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => { window.location.hash = '#/review/42'; });
    // REQ-511 (D3): the Build next panel left Review, so its 390 px layout is asserted on the Review row that replaced it.
    const row = page.locator('[data-use-case-row]').first();
    await row.waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-build-next]').count(), 0, 'no Build next panel on Review');
    assert.equal(await page.locator('[data-build-next-row]').count(), 0, 'no Build next rows on Review');
    const title = row.locator('[data-row-name]');
    const value = row.locator('[data-value-box]').first();
    const button = row.getByRole('button', { name: /Build MVP|Open MVP|Rebuild MVP|Building/ });
    assert.equal(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis'), true, 'the title is not cut with an ellipsis');
    const t = await rect(title); const v = await rect(value); const b = await rect(button);
    // The value is a fixed 6.25rem tile (not a text line), so "one short line" is asserted per text line inside it: none wraps (22px figure, 11px labels).
    const lines = await value.evaluate((el) => [...el.querySelectorAll('span')].filter((x) => x.textContent.trim()).map((x) => x.getBoundingClientRect().height));
    assert.ok(lines.length > 0 && lines.every((h) => h <= 26), `every line of the value box is one line (${lines} px high)`);
    assert.ok(t.w >= 200, `the button leaves the title room (${t.w} px wide)`);
    assert.equal(touches(t, b), false, 'the title and the button do not overlap');
    assert.ok(b.r <= 390 && v.r <= 390.5, 'nothing runs off the screen');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

// D36: the first theme
for (const [name, scheme, saved, expected] of [['dark system, nothing saved', 'dark', null, true], ['light system, nothing saved', 'light', null, false],
  ['dark system, light saved', 'dark', 'light', false], ['light system, dark saved', 'light', 'dark', true]]) {
  test(`D36: first load with ${name} is ${expected ? 'dark' : 'light'}`, async () => {
    const ui = await openUi('app', REVIEW_STATE, '', { mount: baseMount,
      init: async (page) => { await page.emulateMedia({ colorScheme: scheme }); if (saved) await page.addInitScript((s) => localStorage.setItem('inspire_theme', s), saved); } });
    try {
      await ui.page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
      assert.equal(await ui.page.evaluate(() => document.documentElement.classList.contains('dark')), expected);
    } finally { await ui.close(); }
  });
}

// D24 remainder: the card shows only the saved value
test('D24: once a value is saved the card shows the box and not the old estimate text', async () => {
  PUTS.length = 0;
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: (app) => {
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: { 'N01-U01': { status: 'estimated', amount: 3000, currency: 'USD', app: 'Acme App' } }, totals: null }));
    calcMount(app);
  } });
  const { page } = ui;
  try {
    const dialog = await openCalc(page, 'Predict churn');
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Accept and save', exact: true }).click();
    const card = cardOf(page, 'Predict churn');
    await card.locator('[data-value-yearly]').waitFor({ timeout: 15000 });
    assert.equal(await card.locator('[data-value-estimate]').count(), 0, 'no estimate line beside the saved value');
    assert.doesNotMatch(await card.innerText(), /Unverified estimate/);
  } finally { await ui.close(); }
});
