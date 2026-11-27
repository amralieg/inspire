// c29_runcard (REQ-575): each run card shows the average Inspire score and the value at stake on the inline end, its counts are chips that filter
// the run list, and a search box finds runs by name or use case title.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { inspireScoreFromUc } from '../../src/lib/useCaseFields.js';

test.after(closeBrowser);

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ucs = (scores, titles) => scores.map((s, i) => ({ Name: titles[i], inspire_score: s }));
const mean = (list) => list.reduce((sum, uc) => sum + inspireScoreFromUc(uc), 0) / list.length;
const RUNS = {
  81: { name: 'Alpha Bakery', ucs: ucs([8.0, 7.0, 6.5, 9.2], ['Forecast bread demand', 'Cut oven energy', 'Route deliveries', 'Spot waste early']) },
  82: { name: 'Beta Foods', ucs: ucs([5.1, 6.3, 4.4], ['Plan shift rosters', 'Price promotions', 'Predict stock-outs']) },
  83: { name: 'Gamma Retail', ucs: ucs([3.0, 4.0, 5.0], ['Score supplier risk', 'Match returns to causes', 'Reduce wasted packaging']) },
};
const sessions = Object.entries(RUNS).map(([sid, run], i) => ({
  session_id: sid, business_name: run.name, completed_percent: 100, processing_status: 'done', create_at: ago(60000 * (i + 1)), completed_on: ago(60000 * (i + 1)),
  business_runs: 1, business_rank: 1,
  usecase_overview: { total: run.ucs.length, high: 1, meets: 2, below: run.ucs.length - 2, domains: 2, unread: {}, avg_inspire_score: mean(run.ucs),
    preview_use_cases: run.ucs.slice(0, 2).map((uc) => ({ Name: uc.Name, name_with_technique: null })), use_case_titles: run.ucs.map((uc) => uc.Name) },
}));
const state = {
  sessions,
  portfolioRuns: [{ runs: '3', businesses: '3' }],
  portfolioUseCases: [
    { sid: null, is_total: '1', use_cases: '10', domains: '3', subdomains: '4', best_of_best: '0' },
    ...Object.entries(RUNS).map(([sid, run]) => ({ sid, is_total: '0', use_cases: String(run.ucs.length), domains: '2', subdomains: '2', best_of_best: '0' })),
  ],
  portfolioMvps: [
    { sid: null, is_total: '1', mvps_started: '3', mvps_live: '2', mvps_building: '1', mvps_failed: '0', apps: '1', dashboards: '1', genie_spaces: '1', alerts: '0' },
    { sid: '81', is_total: '0', mvps_started: '3', mvps_live: '2', mvps_building: '1', mvps_failed: '0', apps: '1', dashboards: '1', genie_spaces: '1', alerts: '0' },
  ],
};
const value = (amount) => ({ totals: [{ currency: 'USD', amount, calculated: 0, estimated: amount }], n: 3, n_calculated: 0, n_estimated: 1, n_measured: 0, n_none: 0, n_shared: 0 });
const TOTALS = { runs: [{ session_id: '81', run_value: value(3.1e6) }, { session_id: '82', run_value: value(1.2e6) }, { session_id: '83', run_value: value(0.4e6) }],
  all: value(4.7e6), truncated: false, cap: 20 };
const mount = (app) => app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
const CHIPS = ['use_cases', 'quality_bar', 'high_priority', 'domains', 'mvps_built', 'mvps_building', 'mvps_failed'];
const rows = (page) => page.locator('[data-run]').evaluateAll((els) => els.map((el) => el.getAttribute('data-run')));

async function open() {
  const ui = await openUi('choose', state, '', { mount });
  await ui.page.locator('[data-run="83"] [data-run-value-box]').waitFor({ timeout: 20000 });
  return ui;
}

test('REQ-575 a: each run card holds its average Inspire score and its value at stake in one right-hand column', async () => {
  const ui = await open();
  try {
    for (const sid of Object.keys(RUNS)) {
      const aside = ui.page.locator(`[data-run="${sid}"] [data-run-aside]`);
      await aside.waitFor({ timeout: 10000 });
      assert.equal((await aside.locator('[data-score-box]').innerText()).includes(mean(RUNS[sid].ucs).toFixed(1)), true, `run ${sid} average score ${mean(RUNS[sid].ucs).toFixed(1)}`);
      assert.equal(await aside.locator('[data-run-value-box]').count(), 1, `run ${sid} value box sits in the same column`);
      // REQ-576: the one disclaimer moved to the top of the page; the card keeps its own provisional status word.
      assert.match(await aside.innerText(), /provisional/, `run ${sid} keeps the provisional status`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-575 b: seven chips show the counts; MVPs built filters the list, is pressed, and Clear filter restores it', async () => {
  const ui = await open();
  try {
    const { page } = ui;
    const chips = await page.locator('[data-run="81"] [data-run-chip]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-run-chip'), el.textContent.replace(/\s+/g, ' ').trim()]));
    assert.deepEqual(chips.map(([key]) => key), CHIPS);
    assert.match(chips[0][1], /^4 use cases/);
    assert.match(chips[4][1], /^2 MVPs built/);
    assert.match(chips[5][1], /^1 building/);
    assert.deepEqual(await rows(page), ['81', '82', '83']);
    const built = page.locator('[data-run="81"] [data-run-chip="mvps_built"]');
    assert.equal(await built.getAttribute('aria-pressed'), 'false');
    await built.click();
    assert.deepEqual(await rows(page), ['81']);
    assert.equal(await page.locator('[data-run="81"] [data-run-chip="mvps_built"]').getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Clear filter' }).click();
    assert.deepEqual(await rows(page), ['81', '82', '83']);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-575 c: search finds a run by a use case title that is not in its preview, names it, and says so when nothing matches', async () => {
  const ui = await open();
  try {
    const { page } = ui;
    const box = page.getByRole('searchbox', { name: 'Search runs and use cases' });
    await box.fill('wasted packaging');
    assert.deepEqual(await rows(page), ['83']);
    assert.match(await page.locator('[data-run="83"] [data-run-match]').innerText(), /Reduce wasted packaging/);
    await box.fill('no such thing anywhere');
    assert.deepEqual(await rows(page), []);
    await page.locator('[data-runs-empty]').waitFor();
    await page.getByRole('button', { name: 'Clear search' }).click();
    assert.deepEqual(await rows(page), ['81', '82', '83']);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('REQ-575 d: the score column sits on the inline end, right in left-to-right and left in right-to-left', async () => {
  const ui = await open();
  try {
    const { page } = ui;
    const side = () => page.evaluate(() => {
      const card = document.querySelector('[data-run="81"]').getBoundingClientRect();
      const aside = document.querySelector('[data-run="81"] [data-run-aside]').getBoundingClientRect();
      return (aside.left + aside.right) / 2 - (card.left + card.right) / 2;
    });
    assert.ok(await side() > 0, 'left to right: the column is right of the card centre');
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    assert.ok(await side() < 0, 'right to left: the column is left of the card centre');
  } finally { await ui.close(); }
});
