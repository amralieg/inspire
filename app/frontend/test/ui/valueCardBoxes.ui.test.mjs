// REQ-438, REQ-439: the card shows the score box and the value box side by side, "How we got this number" explains the amount,
// the Results page shows the value of the run, and the runs list shows the value across all runs. HTTP-level mocks of
// GET /api/inspire/value/answers (C5), PUT answers (C3/C4) and GET /api/inspire/value/totals (C6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView, totalsQueryMissing } from './uiSupport.mjs';
import { goTo, saveFrom } from './valueWizardSupport.mjs';
import { openReader } from './reviewRows.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };

const PARTS = [
  { id: 'data', label: 'Fraud losses avoided', verb: 'REDUCE COST', amount: 2000000, per_group: true, inputs: [
    { id: 'records', label: 'fraud cases a year', kind: 'count', value: 2400, source: 'data' },
    { id: 'loss', label: 'loss per case', kind: 'money', value: 4450, source: 'data' },
    { id: 'avoided', label: 'share avoided', kind: 'pct', value: 30, source: 'estimate' }] },
  { id: 'time_saved', label: 'Analyst time saved', verb: 'REDUCE COST', amount: 390000, per_group: false, inputs: [
    { id: 'hours', label: 'hours saved', kind: 'hours', value: 2.5, source: 'estimate' }] },
];
const yearlyOf = ({ amount = 2390000, verb = 'REDUCE COST', calculated = true, stale = false } = {}) => ({ verb, period: 'Per Year', estimated: !calculated,
  calculated, currency: 'USD', total: { unit: 'USD', amount }, parts: PARTS, groups: { grouping_label: 'By region', covered: 7, of: 9 },
  case_noun: 'fraud case', attribution_pct: 40, saved_by: 'sara@example.com', saved_at: '2026-11-20T10:42:00Z', version: 3, stale });
const answerEntry = (yearly) => ({ version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 40, drivers: {}, calculated: yearly.calculated }, yearly,
  saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: Boolean(yearly.stale) });

const useCaseEntry = (status, verb, amount) => (status === 'none' || status === 'no_data'
  ? { status, verb: null, amount: null, currency: null } : { status, verb, amount, currency: 'USD' });
// The C6 reply from the contract example: 3.2M calculated, 2.4M and 1.1M estimated, one with no number.
const RUN_TOTALS = {
  run: { totals: [{ currency: 'USD', amount: 6700000, calculated: 3200000, estimated: 3500000 }], n: 4, n_calculated: 1, n_estimated: 2, n_none: 1,
    by_verb: [{ currency: 'USD', verb: 'AVOID RISK', amount: 3200000 }, { currency: 'USD', verb: 'GROW REVENUE', amount: 2400000 }, { currency: 'USD', verb: 'REDUCE COST', amount: 1100000 }] },
  use_cases: { 'N01-U01': useCaseEntry('calculated', 'AVOID RISK', 3200000), 'N01-U02': useCaseEntry('estimated', 'GROW REVENUE', 2400000),
    'N01-U03': useCaseEntry('estimated', 'REDUCE COST', 1100000), 'N01-U04': useCaseEntry('none') },
};

// state: { answers: {<id>: entry}, totals: C6 reply or null, puts: [], onPut }
function mountWith(state) {
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || (state.totals ? res.json(state.totals) : res.status(404).json({ error: 'none' })));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: state.answers || {} }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
    app.put('/api/inspire/value/answers', (req, res) => {
      state.puts?.push(req.body);
      const next = state.onPut ? state.onPut(req.body) : yearlyOf({ amount: 2390000 });
      res.json({ version: 4, yearly: next, disclaimer: 'x' });
    });
  };
}

const withTotals = (id, entry) => ({ ...RUN_TOTALS, use_cases: { ...RUN_TOTALS.use_cases, [id]: entry } });

async function openCard(state) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountWith(state) });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[data-use-case-row]').first().waitFor();
  const card = list.locator('[data-use-case-row]').filter({ hasText: 'Predict churn' });
  return { ui, card, page: ui.page, list };
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

test('1: a calculated card shows two boxes of the same size, the score box solid red, the value box REDUCE COST / $2.39M / (calculated) / Per year / CHECKED', async () => {
  const { ui, card, page } = await openCard({ answers: { 'N01-U01': answerEntry(yearlyOf()) }, totals: withTotals('N01-U01', useCaseEntry('calculated', 'REDUCE COST', 2390000)) });
  try {
    const value = card.locator('[data-value-box]');
    await value.waitFor({ timeout: 15000 });
    const score = card.locator('[data-score-box]');
    const a = await score.boundingBox();
    const b = await value.boundingBox();
    assert.ok(Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1, `same size: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    assert.ok(Math.abs(a.y - b.y) <= 1 && b.x > a.x, 'side by side');
    // REQ-516 (A7, Amr 14:45Z): in the Review row the score box is uncoloured and the value box carries the solid red token.
    const probe = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'bg-primary-solid';
      document.body.appendChild(el);
      const css = getComputedStyle(el).backgroundColor;
      el.remove();
      return css;
    });
    const got = await score.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    assert.notEqual(got.bg, probe, 'the score box is not the solid red token');
    assert.notEqual(got.fg, 'rgb(255, 255, 255)');
    const vgot = await value.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el.querySelector('[data-value-amount]')).color }));
    assert.equal(vgot.bg, probe, 'the value box is the solid red token');
    assert.equal(vgot.fg, 'rgb(255, 255, 255)');
    assert.match(await text(score), /INSPIRE\s*7\.4\s*score/i);
    assert.equal((await text(value.locator('[data-value-verb]'))).toUpperCase(), 'REDUCE COST');
    assert.equal(await text(value.locator('[data-value-amount]')), '$2.39M');
    assert.equal(await text(value.locator('[data-value-qualifier]')), 'Reviewed calculation');
    assert.equal(await text(value.locator('[data-value-period]')), 'Per year');
    assert.equal(await text(value.locator('[data-value-tag]')), '✓ REVIEWED');
    assert.equal(await value.locator('button[aria-label="Edit value"]').isVisible(), true);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('2: estimated, out of date, GROW REVENUE, none and no data each read as the wireframe states', async () => {
  const cases = [
    ['estimated', { answers: { 'N01-U01': answerEntry(yearlyOf({ calculated: false })) }, totals: withTotals('N01-U01', useCaseEntry('estimated', 'REDUCE COST', 2390000)) },
      async (card) => { const v = card.locator('[data-value-box]'); assert.equal(await text(v.locator('[data-value-qualifier]')), 'Provisional estimate'); assert.equal(await text(v.locator('[data-value-tag]')), 'PROVISIONAL'); }],
    ['stale', { answers: { 'N01-U01': answerEntry(yearlyOf({ stale: true })) }, totals: withTotals('N01-U01', useCaseEntry('calculated', 'REDUCE COST', 2390000)) },
      async (card) => { assert.equal(await text(card.locator('[data-value-box] [data-value-tag]')), 'DATA CHANGED'); }],
    ['grow', { answers: { 'N01-U01': answerEntry(yearlyOf({ verb: 'GROW REVENUE' })) }, totals: withTotals('N01-U01', useCaseEntry('calculated', 'GROW REVENUE', 2390000)) },
      async (card) => {
        const v = card.locator('[data-value-box]');
        assert.equal((await text(v.locator('[data-value-verb]'))).toUpperCase(), 'GROW REVENUE');
        // REQ-516 (A7): every value box in the row is filled with the primary token and the figure is white, GROW REVENUE included.
        const colors = await v.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, amount: getComputedStyle(el.querySelector('[data-value-amount]')).color }));
        assert.equal(colors.amount, 'rgb(255, 255, 255)', `white amount: ${colors.amount}`);
        const [r, g, b] = colors.bg.match(/\d+/g).map(Number);
        assert.ok(r > g && r > b, `red fill: ${colors.bg}`);
      }],
    ['none', { answers: {}, totals: withTotals('N01-U01', useCaseEntry('none')) },
      async (card) => {
        const v = card.locator('[data-value-box]');
        assert.match(await text(v), /\+\s*Calculate value/);
        assert.equal(await v.evaluate((el) => getComputedStyle(el).borderTopStyle), 'dashed');
      }],
    ['no data', { answers: {}, totals: withTotals('N01-U01', useCaseEntry('no_data')) },
      async (card) => {
        const v = card.locator('[data-value-box]');
        assert.match(await text(v), /No data to count/);
        assert.equal(await card.locator('[data-value-box] button, [data-value-calculate], [data-value-edit]').count(), 0, 'no button');
      }],
  ];
  for (const [name, state, check] of cases) {
    const { ui, card } = await openCard(state);
    try {
      await card.locator('[data-value-box]').waitFor({ timeout: 15000 });
      await check(card);
      assert.deepEqual(ui.pageErrors, [], name);
    } finally { await ui.close(); }
  }
});

test('3: How we got this number lists each part with data and estimate chips and the groups covered, and Open the full calculation opens the dialog', async () => {
  const { ui, card, page } = await openCard({ answers: { 'N01-U01': answerEntry(yearlyOf()) }, totals: withTotals('N01-U01', useCaseEntry('calculated', 'REDUCE COST', 2390000)) });
  try {
    await card.locator('[data-value-box]').waitFor({ timeout: 15000 });
    const reader = await openReader(page, card);
    await reader.getByRole('button', { name: /How we got this number/ }).click();
    const how = reader.locator('[data-value-how]');
    await how.waitFor();
    assert.equal(await how.locator('[data-how-part]').count(), 2);
    assert.equal(await how.locator('[data-chip="data"]').count(), 2);
    assert.equal(await how.locator('[data-chip="estimate"]').count(), 2);
    const first = await text(how.locator('[data-how-part]').first());
    assert.match(first, /×/);
    assert.match(first, /= \$2M/);
    const meta = await text(how);
    assert.match(meta, /7 of 9 groups covered/);
    assert.match(meta, /Counted per fraud case, by region/i);
    assert.match(meta, /40% credited/);
    assert.match(meta, /reviewed and accepted by sara@example\.com/);
    assert.match(meta, /\(version 3\)/);
    await how.getByRole('button', { name: 'Open the full calculation' }).click();
    await page.getByRole('dialog', { name: /^Calculating Value at Stake for / }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('4: the run panel shows $6.7M, 1 calculated / 2 estimated, four rows and the run total, and a row click scrolls to its card', async () => {
  const { ui, page } = await openCard({ answers: {}, totals: RUN_TOTALS });
  try {
    await toView(page, 'Overview');
    const panel = page.locator('[data-value-run-panel]');
    await panel.waitFor({ timeout: 15000 });
    assert.equal(await text(panel.locator('[data-value-total] [data-total-amount]')), '$6.7M');
    assert.match(await text(panel), /1 reviewed calculation · 2 provisional estimates/);
    assert.equal(await panel.locator('tr[data-value-row]').count(), 4);
    assert.equal(await text(panel.locator('[data-value-run-total]')), 'Run total $6.7M');
    await panel.locator('tr[data-value-row="N01-U04"]').click();
    const target = page.locator('[data-use-case-no="N01-U04"]');
    await target.waitFor();
    await page.waitForFunction(() => {
      const r = document.querySelector('[data-use-case-no="N01-U04"]')?.getBoundingClientRect();
      return r && r.top >= 0 && r.bottom <= window.innerHeight;
    }, null, { timeout: 5000 });
    assert.equal(await target.getAttribute('data-value-pulse'), 'on', 'the card pulses');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

async function openRuns(allReply) {
  const state = { answers: {}, totals: null };
  const mount = mountWith(state);
  const ui = await openUi('app', { ...REVIEW_STATE }, '', { mount: (app) => {
    app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || (req.query.session_id ? res.json(RUN_TOTALS) : res.json(allReply)));
    mount(app);
  } });
  await ui.page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
  // REQ-510 L2: the all-runs value panel opens from the Start More menu.
  await ui.page.getByRole('button', { name: 'More', exact: true }).click();
  await ui.page.getByRole('menuitem', { name: 'Value across all runs' }).click();
  const panel = ui.page.locator('[data-value-all-panel]');
  await panel.waitFor({ timeout: 20000 });
  return { ui, panel };
}
const runRow = (session_id, name, usd) => ({ session_id, name, created_at: '2026-11-20T10:00:00Z', n: 4, n_calculated: 1, n_estimated: 2, n_none: 1,
  totals: [{ currency: 'USD', amount: usd, calculated: usd / 2, estimated: usd / 2 }] });

test('5: the all-runs panel has no per-run table and shows a grand total equal to their sum, and two currencies give two totals', async () => {
  const runs = [runRow('42', 'Run one', 6700000), runRow('41', 'Run two', 2140000), runRow('50', 'Run three', 9800000)];
  const one = await openRuns({ runs, all: { totals: [{ currency: 'USD', amount: 3790000, calculated: 1895000, estimated: 1895000 }], n_calculated: 3, n_estimated: 6 } });
  try {
    assert.equal(await one.panel.locator('[data-all-runs-row]').count(), 0, 'per-run totals live in the run cards, not in the panel');
    assert.equal(await text(one.panel.locator('[data-value-total] [data-total-amount]')), '$3.79M');
    assert.equal(await one.panel.locator('[data-value-total] [data-total-amount]').count(), 1);
    assert.deepEqual(one.ui.pageErrors, []);
  } finally { await one.ui.close(); }
  const mixed = [runRow('42', 'Run one', 6700000), { ...runRow('41', 'Run two', 5000000), totals: [{ currency: 'AED', amount: 5000000, calculated: 0, estimated: 5000000 }] },
    runRow('50', 'Run three', 9800000)];
  const two = await openRuns({ runs: mixed, all: { totals: [{ currency: 'USD', amount: 16500000, calculated: 8250000, estimated: 8250000 },
    { currency: 'AED', amount: 5000000, calculated: 0, estimated: 5000000 }], n_calculated: 2, n_estimated: 5 } });
  try {
    const amounts = await two.panel.locator('[data-value-total] [data-total-amount]').allInnerTexts();
    assert.deepEqual(amounts.map((s) => s.trim()), ['$16.5M', 'AED 5M']);
  } finally { await two.ui.close(); }
});

test('6: after a PUT answers succeeds, the card amount and the run total change without a reload', async () => {
  const state = { answers: { 'N01-U01': answerEntry(yearlyOf()) }, totals: withTotals('N01-U01', useCaseEntry('calculated', 'REDUCE COST', 2390000)), puts: [] };
  state.totals.run.totals = [{ currency: 'USD', amount: 5000000, calculated: 2390000, estimated: 2610000 }];
  state.onPut = () => {
    const next = yearlyOf({ amount: 3000000 });
    state.answers = { 'N01-U01': answerEntry(next) };
    state.totals = { ...state.totals, run: { ...state.totals.run, totals: [{ currency: 'USD', amount: 5610000, calculated: 3000000, estimated: 2610000 }] },
      use_cases: { ...state.totals.use_cases, 'N01-U01': useCaseEntry('calculated', 'REDUCE COST', 3000000) } };
    return next;
  };
  const { ui, card, page } = await openCard(state);
  try {
    const amount = card.locator('[data-value-box] [data-value-amount]');
    await amount.waitFor({ timeout: 15000 });
    assert.equal(await text(amount), '$2.39M');
    await toView(page, 'Overview');
    assert.equal(await text(page.locator('[data-value-run-panel] [data-value-total] [data-total-amount]')), '$5M');
    await toView(page, 'Use cases');
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
    await dialog.waitFor();
    // REQ-507: walk to the story approval, then the one PUT is "Accept and save" (terms ticked first).
    await goTo(dialog, 'terms');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await saveFrom(dialog);
    await page.waitForFunction(() => document.querySelector('[data-use-case-no="N01-U01"] [data-value-amount]')?.textContent.trim() === '$3M', null, { timeout: 15000 });
    assert.equal(state.puts.length, 1);
    await page.keyboard.press('Escape');
    await toView(page, 'Overview');
    await page.waitForFunction(() => document.querySelector('[data-value-run-panel] [data-value-total] [data-total-amount]')?.textContent.trim() === '$5.61M', null, { timeout: 15000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
