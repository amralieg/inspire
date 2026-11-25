// REQ-523: the score-refine banner and the "Refined from" Undo are gone. REQ-524: in the side panel (reader) the VALUE box is the filled one,
// the SCORE box is uncoloured, and the status pill sits inside the box, below "Per year", touching no text. Same pill rule on the MVP value panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { openReader } from './reviewRows.mjs';
import { mountScopeRoutes } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const entry = (amount) => ({ verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }],
  basis: { sampled_records: 1200, eligible_records: 48000, days: 90 } });
const outOfOrder = () => {
  const out = structuredClone(REVIEW_RESULTS);
  for (const domain of out.domains) for (const u of domain.use_cases) {
    if (u.No === 'N01-U01' || u.No === 'N01-U02') { u.best_of_best = 'N'; delete u.best_of_best_rank; }
    if (u.No === 'N01-U01') u.inspire_score = '9.0';
    if (u.No === 'N01-U02') u.inspire_score = '8.5';
  }
  return out;
};
const mountRefine = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': entry(1e6), 'N01-U02': entry(3e6) } }));
};

test('REQ-523: an out-of-order pair shows no refine banner, no Apply or Keep', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: outOfOrder() }, '', { mount: mountRefine });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor({ timeout: 15000 });
    await page.locator('[data-use-case-row][data-use-case-no="N01-U02"] [data-value-yearly]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    assert.doesNotMatch((await page.locator('body').innerText()).replace(/\s+/g, ' '), /order follows the value/);
    assert.equal(await page.getByRole('region', { name: 'Score refinement' }).count(), 0);
    for (const name of ['Apply', 'Keep']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `no ${name} button`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-523: a use case with refined_from shows its score, no Undo, no "Refined from" title', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: outOfOrder(),
    useCases: [{ No: 'N01-U02', id: 'N01-U02', inspire_score: 8.5, refined_score: 9.05, refined_from: 8.5 }] }, '', { mount: mountRefine });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor({ timeout: 15000 });
    const row = list.locator('[data-use-case-row][data-use-case-no="N01-U02"]');
    await row.locator('[data-score-box]').waitFor({ timeout: 15000 });
    const reader = await openReader(page, row);
    await reader.locator('[data-score-box]').waitFor();
    assert.equal(await page.getByRole('button', { name: /Undo/ }).count(), 0, 'no Undo button');
    assert.equal(await page.locator('[title*="Refined from"]').count(), 0, 'no "Refined from" title');
    assert.match((await reader.locator('[data-score-box]').innerText()).replace(/\s+/g, ' '), /9\.05|9\.1/, 'the score is shown');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

// REQ-524 fixtures: one reviewed value, the same shape the Review row tests use.
const YEARLY = { verb: 'AVOID RISK', period: 'Per Year', estimated: false, calculated: true, currency: 'USD', total: { unit: 'USD', amount: 173000 }, parts: [],
  case_noun: 'fraud case', attribution_pct: 40, saved_by: 'sara@example.com', saved_at: '2026-11-20T10:42:00Z', version: 3, stale: false };
const ANSWER = { version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 40, drivers: {}, calculated: true }, yearly: YEARLY, saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false };
const TOTALS = { run: { totals: [], n: 1, n_calculated: 1, n_estimated: 0, n_none: 0, by_verb: [] },
  use_cases: { 'N01-U01': { status: 'calculated', verb: 'AVOID RISK', amount: 173000, currency: 'USD' } } };
const mountReviewed = (app) => {
  mountRefine(app);
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: { 'N01-U01': ANSWER } }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
};
const paint = (loc) => loc.evaluate((e) => {
  const probe = (prop, v) => { const i = document.createElement('i'); i.style[prop] = v; document.body.appendChild(i); const c = getComputedStyle(i)[prop]; i.remove(); return c; };
  const amount = e.querySelector('[data-value-amount]');
  return { bg: getComputedStyle(e).backgroundColor, primary: probe('color', 'var(--color-primary)'), surface: probe('color', 'var(--color-surface)'),
    amount: amount ? getComputedStyle(amount).color : null };
});
const rects = (loc) => loc.evaluate((box) => {
  const r = (el) => { const x = el.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom }; };
  const q = (s) => box.querySelector(s);
  return { box: r(box), tag: r(q('[data-value-tag]')), period: r(q('[data-value-period]')), amount: r(q('[data-value-amount]')) };
});
const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
const assertPillInside = (m, what) => {
  assert.ok(m.tag.l >= m.box.l && m.tag.r <= m.box.r && m.tag.t >= m.box.t && m.tag.b <= m.box.b - 2, `${what}: the pill is inside the box with 2px to the bottom border (${JSON.stringify(m)})`);
  assert.ok(!hit(m.tag, m.period), `${what}: the pill does not touch "Per year"`);
  assert.ok(!hit(m.tag, m.amount), `${what}: the pill does not touch the amount`);
};

test('REQ-524: side panel, the value box is filled with white text, the score box is uncoloured, the pill sits inside', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountReviewed });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row][data-use-case-no="N01-U01"] [data-value-yearly]').waitFor({ timeout: 15000 });
    const reader = await openReader(page, list.locator('[data-use-case-row][data-use-case-no="N01-U01"]'));
    const value = reader.locator('[data-value-box]').first();
    await value.waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);
    const v = await paint(value);
    const s = await paint(reader.locator('[data-score-box]').first());
    assert.equal(v.bg, v.primary, 'the value box is the primary-solid colour');
    assert.equal(v.amount, 'rgb(255, 255, 255)', 'the amount is white');
    assert.equal(s.bg, s.surface, 'the score box is the surface colour');
    assertPillInside(await rects(value), 'side panel');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-524: the MVP value panel pill sits inside its box', async () => {
  const state = { answers: { 'N01-U01': ANSWER }, totals: TOTALS };
  const ui = await openUi('valuePanel', { me: { userName: 'owner@example.com', displayName: 'Owner' } }, '', { mount: (app) => {
    mountScopeRoutes(app);
    app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(state.totals));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: state.answers }));
  } });
  try {
    const box = ui.page.locator('[data-mvp-value] [data-value-box]').first();
    await box.waitFor({ timeout: 15000 });
    await ui.page.waitForTimeout(700);
    assertPillInside(await rects(box), 'MvpValuePanel');
  } finally { await ui.close(); }
});

test('REQ-524 must-keep: the Review row value box is still filled and its score box uncoloured', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: mountReviewed });
  const { page } = ui;
  try {
    const row = page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row][data-use-case-no="N01-U01"]');
    await row.locator('[data-value-yearly]').waitFor({ timeout: 15000 });
    const v = await paint(row.locator('[data-value-box]'));
    const s = await paint(row.locator('[data-score-box]'));
    assert.equal(v.bg, v.primary);
    assert.equal(s.bg, s.surface);
  } finally { await ui.close(); }
});
