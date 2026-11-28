// c33 lane A acceptance (REQ-577, REQ-578): the Start page. One coloured "Start New Discovery" button replaces the three start choices,
// the demo run is pinned first in Previous runs and marked Demo, a first visit shows the demo and an empty card, and step 1 of the
// wizard asks "What would you like to do?". Regressions: the run cards keep value and average score; no Arabic text is added.
// Written by the c33 planner; the lane A builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowser, openUi, totalsQueryMissing, until } from './uiSupport.mjs';
import { inspireScoreFromUc } from '../../src/lib/useCaseFields.js';
import { PATH_TEXT, START_NEW_DISCOVERY, WIZ_TITLE } from '../../src/lib/startWizard.js';

test.after(closeBrowser);

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const RUNS = {
  91: { name: 'Delta Run', titles: ['Plan rosters', 'Price promotions', 'Predict stock-outs'], scores: [7, 7, 6] },
  92: { name: 'Epsilon Small', titles: ['Plan rosters', 'Price promotions', 'Predict stock-outs', 'Route trucks'], scores: [8, 6, 4, 5] },
};
const sessions = Object.entries(RUNS).map(([sid, run], i) => ({
  session_id: sid, business_name: run.name, completed_percent: 100, processing_status: 'done', create_at: ago(60000 * (i + 1)), completed_on: ago(60000 * (i + 1)),
  business_runs: 1, business_rank: 1,
  usecase_overview: { total: run.titles.length, high: 1, meets: 2, below: run.titles.length - 2, domains: 2, unread: {},
    avg_inspire_score: run.scores.reduce((a, b) => a + inspireScoreFromUc({ inspire_score: b }), 0) / run.scores.length,
    preview_use_cases: run.titles.map((Name) => ({ Name, name_with_technique: null })), use_case_titles: run.titles },
}));
const STATE = { sessions, portfolioRuns: [{ runs: '2', businesses: '2' }], portfolioUseCases: [], portfolioMvps: [] };
const EMPTY = { sessions: [], portfolioRuns: [{ runs: '0', businesses: '0' }], portfolioUseCases: [], portfolioMvps: [] };
const value = (amount) => ({ totals: [{ currency: 'USD', amount, calculated: 0, estimated: amount }], n: 1, n_calculated: 0, n_estimated: 1, n_measured: 0, n_none: 0, n_shared: 0 });
const TOTALS = { runs: [{ session_id: '91', run_value: value(3.1e6) }, { session_id: '92', run_value: value(1.2e6) }], all: value(4.3e6), truncated: false, cap: 20 };
const mount = (app) => app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
const open = (state = STATE, query = '&demo=1') => openUi('choose', state, query, { mount });
const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));

test('REQ-577 1a: one coloured Start New Discovery button replaces the three start choices (must-fail on the base)', async () => {
  const ui = await open();
  try {
    const { page } = ui;
    const start = page.locator('[data-start-new]').first();
    await start.waitFor({ timeout: 20000 });
    assert.equal((await start.innerText()).trim(), START_NEW_DISCOVERY);
    assert.equal(await start.getAttribute('data-variant'), 'primary', 'the button is the primary (coloured) one');
    const bg = await start.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.doesNotMatch(bg, /^rgba\(0, 0, 0, 0\)$|^rgb\(255, 255, 255\)$|^transparent$/, `the button has a fill colour, not ${bg}`);
    assert.equal(await page.locator('[data-start-choice]').count(), 0, 'the old start choices are gone (must-exclude)');
    assert.equal(await page.getByText('No data yet', { exact: true }).count(), 0, 'No data yet is no longer a start choice');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 1a: the demo row is pinned first in Previous runs, marked Demo, opens the demo and cannot be deleted (must-fail on the base)', async () => {
  const ui = await open();
  try {
    const { page } = ui;
    await page.locator('[data-run="92"]').waitFor({ timeout: 20000 });
    const order = await page.locator('[data-run]').evaluateAll((els) => els.map((el) => el.getAttribute('data-run')));
    assert.equal(order[0], 'demo', `the demo row is first: ${order}`);
    const demo = page.locator('[data-run="demo"]');
    assert.equal((await demo.locator('[data-run-demo-badge]').innerText()).trim(), 'Demo');
    assert.equal(await demo.getByRole('button', { name: /delete|remove/i }).count(), 0, 'the demo row has no delete');
    await demo.getByRole('button', { name: 'Open the demo' }).click();
    await until(async () => (await page.locator('output[aria-label="Start clicks"]').innerText()) === 'demo', 'Open the demo calls onDemo');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-578 regression: with the demo pinned, the run cards keep their value and average score (REQ-575, REQ-576) (must-fail on the base)', async () => {
  const ui = await open();
  try {
    const { page } = ui;
    await page.locator('[data-run="demo"]').waitFor({ timeout: 20000 });
    for (const sid of ['91', '92']) {
      const card = page.locator(`[data-run="${sid}"]`);
      await card.locator('[data-run-value-box]').waitFor({ timeout: 20000 });
      assert.match(await card.locator('[data-run-value-box]').innerText(), /\d/, `run ${sid} shows its value`);
      assert.equal(await card.locator('[data-score-box]').count() > 0, true, `run ${sid} shows its average score`);
    }
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 1b: a first visit shows the demo row, the empty card and a second Start New Discovery button (must-fail on the base)', async () => {
  const ui = await open(EMPTY);
  try {
    const { page } = ui;
    await page.getByText('No runs of your own yet').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-run="demo"]').count(), 1, 'the demo row shows on a first visit');
    assert.equal(await page.locator('[data-start-new]').count(), 2, 'the empty card has its own Start New Discovery button');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 2: Start New Discovery opens the wizard at step 1, which asks what to do and offers the sample tables (must-fail on the base)', async () => {
  const ui = await open();
  try {
    const { page } = ui;
    await page.locator('[data-start-new]').first().click();
    const dialog = page.getByRole('dialog', { name: WIZ_TITLE });
    await dialog.waitFor({ timeout: 15000 });
    const step = dialog.locator('[data-wiz-step="start"]');
    await step.getByText('What would you like to do?').waitFor();
    assert.equal((await dialog.locator('[data-wiz-path="discover"]').innerText()).includes(PATH_TEXT.discover), true);
    assert.equal((await dialog.locator('[data-wiz-path="match"]').innerText()).includes(PATH_TEXT.match), true);
    const pills = await dialog.locator('ol[aria-label="Steps"] li').allInnerTexts();
    assert.deepEqual(pills.map((t) => t.replace(/\s+/g, ' ').trim()), ['1. Start'], 'before a path is picked only Start shows');
    assert.equal(await dialog.getByRole('button', { name: 'Next' }).isDisabled(), true, 'Next waits for a choice');
    await dialog.getByRole('button', { name: /Try it on sample tables/ }).click();
    await until(async () => (await page.locator('output[aria-label="Start clicks"]').innerText()).includes('no-data'), 'the sample tables link calls onNoData');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577: the Start page runs the plan advance, so the next run of a plan starts when the one before it ends (must-fail on the base)', () => {
  const choose = fs.readFileSync(path.join(SRC, 'pages', 'ChoosePage.jsx'), 'utf8');
  assert.match(choose, /import \{[^}]*\busePlanAdvance\b[^}]*\} from '\.\.\/lib\/wizPlanClient'/);
  assert.match(choose, /\busePlanAdvance\(/);
  assert.match(choose, /from '\.\.\/components\/startWizard\/StartWizard'/, 'ChoosePage opens the lane A wizard');
});

test('REQ-578: no Arabic text in the Start page or wizard shell sources (the RTL screens are dropped)', () => {
  const files = ['pages/ChoosePage.jsx', 'pages/LaunchPage.jsx', 'App.jsx', 'components/startWizard/StartWizard.jsx', 'components/startWizard/DataStep.jsx', 'lib/startWizard.js'];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    assert.equal((text.match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g) || []).length, 0, `${rel} has no Arabic characters`);
  }
});
