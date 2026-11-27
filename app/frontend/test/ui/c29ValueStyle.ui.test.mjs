// c29_runcard (REQ-576): the value disclaimer shows once at the top of each page, above the first value, and no value box has a red fill
// (no green or amber on red): the box is a neutral card, its status dot has >= 3:1 against it and its amount >= 4.5:1, in light and dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, setDark, totalsQueryMissing, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const value = (amount, calc = 0) => ({ totals: [{ currency: 'USD', amount, calculated: calc, estimated: amount - calc }], n: 3, n_calculated: calc ? 1 : 0, n_estimated: calc ? 0 : 1, n_measured: 0, n_none: 0, n_shared: 0 });
const entry = (status, amount) => ({ status, verb: 'REDUCE COST', amount, currency: 'USD' });
const UCS = { 'N01-U01': entry('calculated', 2000000), 'N01-U02': entry('estimated', 500000) };
const RUN = { ...value(2500000, 2000000), excluded: [], by_verb: [] };
const sessionTotals = { run: RUN, use_cases: UCS, run_value: value(2500000) };
const runsTotals = { runs: ['81', '82', '83'].map((sid, i) => ({ session_id: sid, run_value: value(3e6 - i * 1e6, i === 0 ? 3e6 : 0) })), all: value(6e6), truncated: false, cap: 20 };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(req.query.session_id ? sessionTotals : runsTotals));
};
const sessions = ['81', '82', '83'].map((sid, i) => ({ session_id: sid, business_name: `Run ${sid}`, completed_percent: 100, processing_status: 'done', create_at: ago(60000 * (i + 1)), completed_on: ago(60000 * (i + 1)),
  business_runs: 1, business_rank: 1, usecase_overview: { total: 3, high: 1, meets: 2, below: 1, domains: 2, unread: {}, avg_inspire_score: 6, preview_use_cases: [], use_case_titles: ['A', 'B', 'C'] } }));
const CHOOSE = { sessions, portfolioRuns: [{ runs: '3', businesses: '3' }], portfolioUseCases: [], portfolioMvps: [] };

const rgb = (s) => {
  const nums = (String(s).match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
  if (/^color\(/.test(s)) return nums.slice(0, 3).map((v) => Math.round(v * 255));
  return nums.slice(0, 3);
};
const lum = ([r, g, b]) => { const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const BOXES = '[data-run-value-box], [data-value-box], [data-value-total]';
const DISCLAIMERS = '[data-value-disclaimer], [data-value-footer], [data-value-top]';

// Everything the page measures in the browser: disclaimer count and top, the first value's top, every box's red ancestors, dot and amount contrast inputs.
const probe = (page) => page.evaluate(({ boxes, disclaimers }) => {
  const q = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length);
  const parse = (c) => { const n = (c.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number); return /^color\(/.test(c) ? { rgb: n.slice(0, 3).map((v) => Math.round(v * 255)), a: n[3] ?? 1 } : { rgb: n.slice(0, 3), a: n[3] ?? 1 }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p.a > 0.9) return p.rgb; } return [255, 255, 255]; };
  const values = q('[data-run-value-box], [data-value-total], [data-total-amount], [data-value-box], [data-value-line-amount]');
  const firstTop = Math.min(...values.map((el) => el.getBoundingClientRect().top + window.scrollY));
  const disc = q(disclaimers);
  const red = [];
  for (const box of q(boxes)) for (let e = box; e && e !== document.body; e = e.parentElement) {
    const p = parse(getComputedStyle(e).backgroundColor);
    if (p.a > 0.5 && p.rgb[0] > p.rgb[1] + 60 && p.rgb[0] > p.rgb[2] + 60) { red.push(`${box.tagName}[${[...box.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).join(',')}] <- ${e.tagName}.${String(e.className).slice(0, 60)} ${p.rgb}`); break; }
  }
  const dots = q('[data-run-dot]').map((dot) => ({ dot: parse(getComputedStyle(dot).backgroundColor).rgb, bg: bgOf(dot.closest(boxes) || dot) }));
  const amounts = q('[data-run-value-total], [data-total-amount], [data-value-amount]').map((el) => ({ fg: parse(getComputedStyle(el).color).rgb, bg: bgOf(el) }));
  return { n: disc.length, discTop: disc.length ? disc[0].getBoundingClientRect().top + window.scrollY : null, firstTop, nValues: values.length, red, dots, amounts };
}, { boxes: BOXES, disclaimers: DISCLAIMERS });

async function check(ui, label, { needDots = false } = {}) {
  const { page } = ui;
  for (const dark of [false, true]) {
    await setDark(page, dark);
    const p = await probe(page);
    const at = `${label} (dark=${dark})`;
    assert.ok(p.nValues > 0, `${at}: the page shows a value`);
    assert.equal(p.n, 1, `${at}: exactly one disclaimer node, found ${p.n}`);
    assert.ok(p.discTop < p.firstTop, `${at}: the disclaimer top ${p.discTop} is above the first value ${p.firstTop}`);
    assert.deepEqual(p.red, [], `${at}: no value box or ancestor has a red fill`);
    if (needDots) assert.ok(p.dots.length > 0, `${at}: a status dot is shown`);
    for (const d of p.dots) assert.ok(contrast(d.dot, d.bg) >= 3, `${at}: dot ${d.dot} on ${d.bg} is ${contrast(d.dot, d.bg).toFixed(2)}:1, needs 3:1`);
    for (const a of p.amounts) assert.ok(contrast(a.fg, a.bg) >= 4.5, `${at}: amount ${a.fg} on ${a.bg} is ${contrast(a.fg, a.bg).toFixed(2)}:1, needs 4.5:1`);
  }
}

test('REQ-576 a: Choose, three run cards with value, one disclaimer at the top, neutral boxes, dots >= 3:1', async () => {
  const ui = await openUi('choose', CHOOSE, '', { mount });
  try {
    await ui.page.locator('[data-run="83"] [data-run-value-box]').waitFor({ timeout: 20000 });
    await check(ui, 'choose', { needDots: true });
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-576 b: Results, use cases view and Overview story, one disclaimer at the top, neutral boxes', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  try {
    const { page } = ui;
    await page.locator('[data-run-header-value] [data-run-value-box]').waitFor({ timeout: 20000 });
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-value-box]').first().waitFor({ timeout: 20000 });
    await check(ui, 'results use cases', { needDots: true });
    await toView(page, 'Overview');
    await page.locator('[data-value-total]').first().waitFor({ timeout: 20000 });
    await check(ui, 'results overview', { needDots: true });
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-576 c: Implement, one disclaimer at the top above the first value', async () => {
  const ui = await openUi('implement', STUDIO_STATE, '', { mount });
  try {
    await ui.page.locator('[data-run-value], [data-value-line-amount], [data-value-box]').first().waitFor({ timeout: 20000 });
    await check(ui, 'implement');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
