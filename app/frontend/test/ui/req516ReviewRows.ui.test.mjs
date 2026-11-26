// REQ-516 (wireframe A7): each Review row is the compact old card. Fail-first contract:
// (1) row height 140-180px at 1440 for a 2-line statement; (2) the score box is uncoloured, the value box is filled with the primary token with white text >= 4.5:1 in light and dark;
// (3) badges, chips, domain line, Build MVP and Generate docs live in the row; (4) "How we got this number" and the four build flags live in the reader, not in the row;
// (5) no sideways scroll at 390 and 1280; (6) a long title wraps (no ellipsis) and an Arabic name is dir=auto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, setDark, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { openReader } from './reviewRows.mjs';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const LONG = 'Predict which long-standing loyalty members are likely to lapse in the next two quarters so the retention team can step in before the offers stop working';
const STATEMENT = 'Stores run out of one in twelve fast-moving items each week, and the team only sees it after the shelves are already empty, so lost sales pile up on the very items that drive most of the revenue and shoppers switch to rivals.';
const ARABIC = 'رصد احتيال المرتجعات عند الصندوق قبل خروج العميل';
const NAMES = { 'N01-U01': LONG, 'N01-U02': ARABIC };
const edited = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => (
  { ...u, Statement: STATEMENT, description: STATEMENT, meets_quality_bar: 'Y', best_of_best: 'Y', best_of_best_rank: '1', ...(NAMES[u.No] ? { Name: NAMES[u.No], use_case: NAMES[u.No] } : {}) })) })) };
const PARTS = [{ id: 'data', label: 'Fraud losses avoided', verb: 'REDUCE COST', amount: 2000000, per_group: true, inputs: [
  { id: 'records', label: 'fraud cases a year', kind: 'count', value: 2400, source: 'data' }, { id: 'avoided', label: 'share avoided', kind: 'pct', value: 30, source: 'estimate' }] }];
const YEARLY = { verb: 'REDUCE COST', period: 'Per Year', estimated: false, calculated: true, currency: 'USD', total: { unit: 'USD', amount: 2000000 }, parts: PARTS,
  case_noun: 'fraud case', attribution_pct: 40, saved_by: 'sara@example.com', saved_at: '2026-11-20T10:42:00Z', version: 3, stale: false };
const ANSWER = { version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 40, drivers: {}, calculated: true }, yearly: YEARLY, saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false };
const entry = (status, verb, amount) => (status === 'none' ? { status, verb: null, amount: null, currency: null } : { status, verb, amount, currency: 'USD' });
const TOTALS = {
  run: { totals: [{ currency: 'USD', amount: 2000000, calculated: 2000000, estimated: 0 }], n: 6, n_calculated: 1, n_estimated: 0, n_none: 5, by_verb: [{ currency: 'USD', verb: 'REDUCE COST', amount: 2000000 }] },
  use_cases: { 'N01-U01': entry('calculated', 'REDUCE COST', 2000000), 'N01-U02': entry('none'), 'N01-U03': entry('none'), 'N01-U04': entry('none'), 'N02-U01': entry('none'), 'N02-U02': entry('none') },
};
function mount(app) {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
  app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: { 'N01-U01': ANSWER } }));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
  app.get('/api/inspire/implement/usecase-assets', (_req, res) => res.json({ use_cases: { 'N01-U01': { app: true, dashboard: false, lakebase: true, genie: false } } }));
}
async function openReview(width = 1440, height = 900) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: edited }, '', { mount });
  await ui.page.setViewportSize({ width, height });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[data-use-case-row]').first().waitFor({ timeout: 15000 });
  await ui.page.locator('[data-use-case-row][data-use-case-no="N01-U01"] [data-value-yearly]').waitFor({ timeout: 15000 });
  return { ui, page: ui.page, list, row: (no) => list.locator(`[data-use-case-row][data-use-case-no="${no}"]`) };
}
const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lum = ([r, g, b]) => { const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const paints = (loc) => loc.evaluate((e) => {
  const probe = document.createElement('i'); probe.style.color = 'var(--color-primary)'; document.body.appendChild(probe);
  const primary = getComputedStyle(probe).color; probe.remove();
  const q = (sel) => e.querySelector(sel);
  return { bg: getComputedStyle(e).backgroundColor, primary, text: q('[data-value-amount]') ? getComputedStyle(q('[data-value-amount]')).color : null,
    verb: q('[data-value-verb]') ? getComputedStyle(q('[data-value-verb]')).color : null };
});

test('1: a row with a 2-line statement is 140-180px tall at 1440', async () => {
  const { ui, row } = await openReview();
  try {
    const b = await row('N01-U03').boundingBox();
    assert.ok(b.height >= 140 && b.height <= 180, `row height ${b.height}px in 140-180`);
    const clamp = await row('N01-U03').locator('[data-row-statement]').evaluate((e) => ({ lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) }));
    assert.equal(clamp.lines, 2, 'the statement clamps to 2 lines');
  } finally { await ui.close(); }
});

test('2: the score box is uncoloured, the value box is filled with the primary token, white value text >= 4.5:1 in light and dark', async () => {
  const { ui, page, row } = await openReview();
  try {
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const score = await paints(row('N01-U01').locator('[data-score-box]'));
      const value = await paints(row('N01-U01').locator('[data-value-box]'));
      assert.notEqual(score.bg, score.primary, `score box is not the primary colour (dark=${dark})`);
      assert.notEqual(value.bg, score.bg, `value box differs from the score box (dark=${dark})`);
      if (!dark) assert.equal(value.bg, value.primary, 'light: the value box is the primary token');
      assert.deepEqual(rgb(value.text), [255, 255, 255], `value amount is white (dark=${dark})`);
      const c = contrast(rgb(value.text), rgb(value.bg));
      assert.ok(c >= 4.5, `white on the value box ${c.toFixed(2)}:1 >= 4.5 (dark=${dark})`);
    }
  } finally { await ui.close(); }
});

test('3: badges, chips, domain line, Build MVP and Generate docs are inside the row', async () => {
  const { ui, row } = await openReview();
  try {
    const r = row('N01-U01');
    const rb = await r.boundingBox();
    for (const [label, loc] of [['Best of Best badge', r.getByText(/Best of Best/)], ['chips', r.locator('[data-kind-chip]')], ['quality bar', r.locator('[data-testid="quality-bar-chip"]')],
      ['domain line', r.locator('[data-row-domain]')], ['Build MVP', r.getByRole('button', { name: /MVP$/ })], ['row More menu (Generate docs and the asset links, REQ-510 L5)', r.getByRole('button', { name: /^More$/ })]]) {
      const b = await loc.first().boundingBox();
      assert.ok(b, `${label} is visible`);
      assert.ok(b.x >= rb.x && b.x + b.width <= rb.x + rb.width + 1 && b.y >= rb.y && b.y + b.height <= rb.y + rb.height + 1, `${label} is inside the row`);
    }
    assert.match((await r.locator('[data-row-domain]').innerText()).replace(/\s+/g, ' '), /Customer/);
  } finally { await ui.close(); }
});

test('4: "How we got this number" and the four build flags are in the reader, not in the row', async () => {
  const { ui, page, row } = await openReview();
  try {
    assert.equal(await row('N01-U01').getByText(/How we got this number/).count(), 0, 'not in the row');
    assert.equal(await row('N01-U01').locator('[data-use-case-assets]').count(), 0, 'no flags in the row');
    const reader = await openReader(page, row('N01-U01'));
    await reader.getByText(/How we got this number/).first().waitFor({ timeout: 10000 });
    const assets = reader.locator('[data-use-case-assets]').first();
    await assets.waitFor({ timeout: 10000 });
    assert.match((await assets.innerText()).replace(/\s+/g, ' '), /App: Yes.*Dashboard: No.*Lakebase: Yes.*Genie Agent: No/);
  } finally { await ui.close(); }
});

test('5: no sideways scroll at 390 and 1280', async () => {
  for (const w of [1280, 390]) {
    const { ui, page, list } = await openReview(w, 900);
    try {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `page scrolls sideways by ${over}px at ${w}`);
      const region = await list.evaluate((e) => e.scrollWidth - e.clientWidth);
      assert.ok(region <= 0, `list scrolls sideways by ${region}px at ${w}`);
    } finally { await ui.close(); }
  }
});

test('6: a long title wraps without an ellipsis, and an Arabic name is dir=auto', async () => {
  const { ui, row } = await openReview();
  try {
    const long = row('N01-U01').locator('[data-row-name]');
    const m = await long.evaluate((e) => ({ over: getComputedStyle(e).textOverflow, ws: getComputedStyle(e).whiteSpace, h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) }));
    assert.notEqual(m.over, 'ellipsis');
    assert.notEqual(m.ws, 'nowrap');
    assert.ok(m.h >= m.lh * 1.5, `the long title wraps onto 2+ lines (${m.h}px)`);
    assert.equal(await row('N01-U02').locator('[data-row-name]').getAttribute('dir'), 'auto');
    assert.equal((await row('N01-U02').locator('[data-row-name]').innerText()).trim(), ARABIC);
  } finally { await ui.close(); }
});
