// RC7-B-01 (T-RES-05): the use case side panel (reader) at 1280, 1440 and 1920 px.
// Contract: >= 12 px between the title and the score box; the title/text column is >= 60% of the panel width; strategy and kind chips wrap, never cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { openReader } from './reviewRows.mjs';

test.after(closeBrowser);

const LONG_PATH = 'Grow revenue through a loyal customer base > Increase repeat purchases across every store format and channel > Personalised retention offers that reach every loyalty member before the seasonal promotions stop working for the stores';
const results = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => (
  { ...u, Name: 'Decompose Daily Revenue Drivers', use_case: 'Decompose Daily Revenue Drivers', strategy_alignment: [{ id: 'G1', path: LONG_PATH, evidence: 'It keeps loyal members buying.' }], 'Strategy Alignment': [{ id: 'G1', path: LONG_PATH, evidence: 'It keeps loyal members buying.' }], 'Strategy Path': LONG_PATH, meets_quality_bar: 'Y' })) })) };
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));

for (const width of [1280, 1440, 1920]) {
  test(`the side panel at ${width}px: title clear of the score box, wide text column, chips wrap`, async () => {
    const ui = await openUi('results', { ...REVIEW_STATE, results }, '', { mount });
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height: 900 });
      const list = page.getByRole('region', { name: 'Use case list' });
      const row = list.locator('[data-use-case-row]').first();
      await row.waitFor({ timeout: 15000 });
      const reader = await openReader(page, row);
      await reader.locator('[data-score-box]').first().waitFor();
      const m = await reader.evaluate((panel) => {
        const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
        const p = r(panel);
        const title = panel.querySelector('h3');
        const score = panel.querySelector('[data-score-box]');
        const t = r(title); const s = r(score);
        const sameRow = t.t < s.b && s.t < t.b;
        const gap = sameRow ? Math.min(Math.abs(s.l - t.r), Math.abs(t.l - s.r)) : Infinity;
        const col = title.closest('div.min-w-0');
        const chips = [...panel.querySelectorAll('[data-strategy-chip],[data-kind-chip],[data-technique-chip]')].map((c) => {
          const b = c.getBoundingClientRect();
          return { cut: c.scrollWidth > c.clientWidth + 1, outside: b.right > p.r + 0.5 || b.left < p.l - 0.5, kind: c.getAttributeNames().find((n) => n.startsWith('data-')) };
        });
        return { panelW: p.w, gap, colW: r(col).w, titleW: t.w, chips };
      });
      assert.ok(m.gap >= 12, `title to score box gap ${m.gap}px >= 12 at ${width}`);
      assert.ok(m.colW / m.panelW >= 0.6, `text column ${m.colW} of panel ${m.panelW} = ${(100 * m.colW / m.panelW).toFixed(0)}% >= 60% at ${width}`);
      assert.ok(m.chips.some((c) => c.kind === 'data-strategy-chip'), 'the fixture shows a strategy chip');
      for (const c of m.chips) assert.ok(!c.cut && !c.outside, `chip ${c.kind} is cut or outside the panel at ${width}`);
      assert.deepEqual(ui.pageErrors, []);
    } finally { await ui.close(); }
  });
}
