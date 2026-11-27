// c29_runcard (REQ-575 follow-up): the value block in the run card's narrow column keeps each phrase whole and the dot clear of the text,
// the quality chip is as short as the other chips, and search finds a use case anywhere in a long run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { inspireScoreFromUc } from '../../src/lib/useCaseFields.js';

test.after(closeBrowser);

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const titles60 = Array.from({ length: 60 }, (_, i) => `Use case number ${i + 1} for long run`);
const RUNS = {
  91: { name: 'Delta Long Run', titles: titles60, scores: titles60.map(() => 7) },
  92: { name: 'Epsilon Small', titles: ['Plan rosters', 'Price promotions', 'Predict stock-outs', 'Route trucks'], scores: [8, 6, 4, 5] },
};
const sessions = Object.entries(RUNS).map(([sid, run], i) => ({
  session_id: sid, business_name: run.name, completed_percent: 100, processing_status: 'done', create_at: ago(60000 * (i + 1)), completed_on: ago(60000 * (i + 1)),
  business_runs: 1, business_rank: 1,
  usecase_overview: { total: run.titles.length, high: 1, meets: 2, below: run.titles.length - 2, domains: 2, unread: {},
    avg_inspire_score: run.scores.reduce((a, b) => a + inspireScoreFromUc({ inspire_score: b }), 0) / run.scores.length,
    preview_use_cases: run.titles.slice(0, 4).map((Name) => ({ Name, name_with_technique: null })), use_case_titles: run.titles },
}));
const state = { sessions, portfolioRuns: [{ runs: '2', businesses: '2' }], portfolioUseCases: [], portfolioMvps: [] };
const value = (amount) => ({ totals: [{ currency: 'USD', amount, calculated: 0, estimated: amount }], n: 1, n_calculated: 0, n_estimated: 1, n_measured: 0, n_none: 0, n_shared: 0 });
const TOTALS = { runs: [{ session_id: '91', run_value: value(3.1e6) }, { session_id: '92', run_value: value(1.2e6) }], all: value(4.3e6), truncated: false, cap: 20 };
const mount = (app) => app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
const open = async () => {
  const ui = await openUi('choose', state, '', { mount });
  await ui.page.locator('[data-run="92"] [data-run-value-box]').waitFor({ timeout: 20000 });
  return ui;
};

test('REQ-575 e: the value block keeps every phrase whole and the status dot never sits on the text', async () => {
  const ui = await open();
  try {
    const box = ui.page.locator('[data-run="92"] [data-run-aside] [data-run-value-box]');
    const info = await box.evaluate((el) => {
      const phrases = [...el.querySelectorAll('[data-run-phrase]')];
      const dot = el.querySelector('[data-run-dot]');
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const dotRect = dot ? dot.getBoundingClientRect() : null;
      return {
        count: phrases.length,
        nowrap: phrases.map((p) => getComputedStyle(p).whiteSpace),
        lines: phrases.map((p) => p.getClientRects().length),
        heights: phrases.map((p) => p.getBoundingClientRect().height),
        overlap: dotRect ? phrases.map((p) => hit(dotRect, p.getBoundingClientRect())) : null,
        text: el.innerText.replace(/\s+/g, ' ').trim(),
        title: el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title') || '',
      };
    });
    assert.ok(info.count >= 2, `value block is made of phrases: ${info.text}`);
    assert.ok(info.nowrap.every((w) => w === 'nowrap'), `every phrase is nowrap: ${info.nowrap}`);
    assert.ok(info.lines.every((n) => n === 1) && info.heights.every((h) => h < 24), `no phrase breaks over lines: ${info.heights}`);
    assert.ok(info.overlap && info.overlap.every((o) => !o), 'the dot does not overlap any phrase');
    assert.match(info.title, /estimate/i, 'the full wording stays available as a tooltip');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-575 f: the quality chip is as short as the other chips and keeps the long sentence as its title', async () => {
  const ui = await open();
  try {
    const chip = ui.page.locator('[data-run="92"] [data-run-chip="quality_bar"]');
    assert.match((await chip.innerText()).replace(/\s+/g, ' ').trim(), /^\d+ good quality$/);
    assert.match(await chip.getAttribute('title'), /^2 of 4 use cases meet the quality bar/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-575 g: search for the 45th use case title of a 60-use-case run finds that run', async () => {
  const ui = await open();
  try {
    await ui.page.getByRole('searchbox', { name: 'Search runs and use cases' }).fill(titles60[44]);
    assert.deepEqual(await ui.page.locator('[data-run]').evaluateAll((els) => els.map((el) => el.getAttribute('data-run'))), ['91']);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
