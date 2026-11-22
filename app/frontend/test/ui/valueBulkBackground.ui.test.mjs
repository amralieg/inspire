// REQ-443: the bulk value run keeps going in the background, app-wide, with a progress bar above the cards.
// Same HTTP-level stubs as valueBulk.ui.test.mjs (case-plan and PUT answers held open, PUT bodies recorded); the whole App is open so a page change is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { PLAN } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const APP_DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const AMOUNTS = { 'N01-U02': 1500000, 'N01-U03': 2000000, 'N01-U04': 2500000, 'N02-U01': 3000000 };
const SHOWN = { 'N01-U02': '$1.5M', 'N01-U03': '$2M', 'N01-U04': '$2.5M', 'N02-U01': '$3M' };
const NAMES = ['Predict churn', 'Score upsell', 'Segment shoppers', 'Price elasticity', 'Forecast stock', 'Spot late suppliers'];

// Spot late suppliers (N02-U02) names no table.
const RESULTS = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => (u.No === 'N02-U02' ? { ...u, 'Tables Involved': '' } : u)) })) };
const yearlyOf = (amount, calculated = false) => ({ verb: 'REDUCE COST', period: 'Per Year', estimated: !calculated, calculated, currency: 'USD', total: { unit: 'USD', amount }, parts: [],
  groups: { grouping_label: 'By region', covered: 3, of: 3 }, case_noun: 'case', attribution_pct: 100 });
const SAVED = { version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 100, drivers: {}, calculated: true }, yearly: yearlyOf(9000000, true),
  saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false };

// state: { hold, plans: [{ id, res }], puts: [{ id, body, res }], planStatus: { <id>: 500 } }
function mountBulk(state) {
  const answer = (list, id, send) => { const at = list.findIndex((e) => e.id === id); if (at >= 0) { const [e] = list.splice(at, 1); send(e.res); } };
  state.releasePlan = (id) => answer(state.plans, id, (res) => res.json({ plan: PLAN }));
  state.releasePut = (id) => answer(state.puts, id, (res) => res.json({ version: 1, yearly: yearlyOf(AMOUNTS[id] ?? 1000000), disclaimer: 'x' }));
  state.started = [];
  state.putBodies = [];
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(APP_DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/totals', (_req, res) => res.json({ run: { totals: [], n: 0, n_calculated: 0, n_estimated: 0, n_none: 0, by_verb: [] }, use_cases: {} }));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: state.noSaved ? {} : { 'N01-U01': SAVED } }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
    app.post('/api/inspire/value/case-plan', (req, res) => {
      const id = req.body.use_case_id;
      state.started.push(id);
      if (state.planStatus?.[id]) return res.status(state.planStatus[id]).json({ error: 'The plan service is down.' });
      state.plans.push({ id, res });
      if (!state.hold) state.releasePlan(id);
    });
    app.put('/api/inspire/value/answers', (req, res) => {
      const id = req.body.use_case_id;
      state.putBodies.push(req.body);
      state.puts.push({ id, res });
      if (!state.hold) state.releasePut(id);
    });
  };
}

async function openBulk(state) {
  const ui = await openUi('app', { ...REVIEW_STATE, results: RESULTS, knownRuns: ['42'] }, '&review=42', { mount: mountBulk(state) });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[aria-expanded]').first().waitFor({ timeout: 20000 });
  return { ui, page: ui.page };
}
const pick = async (page, names) => { for (const n of names) await page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check(); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const poll = async (check, what, timeout = 10000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const IDS = Object.keys(AMOUNTS);
const dialogOf = (page) => page.getByRole('dialog', { name: 'Calculating value' });
const barOf = (page) => page.locator('[data-bulk-bg]');
const barText = async (page) => text(barOf(page).locator('[data-bulk-bg-text]'));

// Six selected (one saved, one without a table): four run. All four case plans answered, so four saves are held open.
async function startHeld() {
  const state = { hold: true, plans: [], puts: [] };
  const { ui, page } = await openBulk(state);
  await pick(page, NAMES);
  await page.getByRole('button', { name: 'Calculate value for 6', exact: true }).click();
  await dialogOf(page).waitFor();
  await poll(() => state.plans.length === 4, 'four case-plan requests open');
  for (const id of IDS) state.releasePlan(id);
  await poll(() => state.puts.length === 4, 'four saves arrive');
  return { state, ui, page };
}

test('1: Run in background hides the dialog; the bar counts live; Open shows the live rows; the dialog ends at 4 of 4', async () => {
  const { state, ui, page } = await startHeld();
  try {
    await dialogOf(page).getByRole('button', { name: 'Run in background', exact: true }).click();
    await dialogOf(page).waitFor({ state: 'detached' });
    const bar = barOf(page);
    await bar.waitFor();
    assert.equal(await barText(page), 'Calculating value: 0 of 4 done');
    const meter = bar.getByRole('progressbar');
    assert.equal(await meter.getAttribute('aria-valuenow'), '0');
    assert.equal(await meter.getAttribute('aria-valuemax'), '4');
    state.releasePut('N01-U02');
    state.releasePut('N01-U03');
    await poll(async () => (await barText(page)) === 'Calculating value: 2 of 4 done', 'the bar says 2 of 4');
    assert.equal(await meter.getAttribute('aria-valuenow'), '2');
    for (const id of ['N01-U02', 'N01-U03']) {
      await poll(async () => (await text(page.locator(`[data-use-case-no="${id}"] [data-value-amount]`))) === SHOWN[id], `card ${id} shows ${SHOWN[id]}`);
    }
    await bar.getByRole('button', { name: 'Open', exact: true }).click();
    const panel = dialogOf(page);
    await panel.waitFor();
    assert.equal(await panel.locator('[data-bulk-row="N01-U02"]').getAttribute('data-bulk-state'), 'done');
    assert.equal(await panel.locator('[data-bulk-row="N01-U03"]').getAttribute('data-bulk-state'), 'done');
    assert.equal(await panel.locator('[data-bulk-row="N01-U04"]').getAttribute('data-bulk-state'), 'working');
    assert.equal(await panel.locator('[data-bulk-row="N02-U01"]').getAttribute('data-bulk-state'), 'working');
    assert.equal(await barOf(page).count(), 0, 'the bar is not shown while the dialog is');
    state.releasePut('N01-U04');
    state.releasePut('N02-U01');
    await poll(async () => (await text(panel.locator('[data-bulk-progress]'))) === '4 of 4 done', 'the dialog says 4 of 4');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

for (const how of ['Esc', 'X']) {
  test(`2: ${how} while running hides the dialog, shows the bar, and the held saves still go through (no abort)`, async () => {
    const { state, ui, page } = await startHeld();
    try {
      if (how === 'Esc') await page.keyboard.press('Escape');
      else await dialogOf(page).getByRole('button', { name: 'Close', exact: true }).click();
      await dialogOf(page).waitFor({ state: 'detached' });
      await barOf(page).waitFor();
      assert.equal(await barText(page), 'Calculating value: 0 of 4 done');
      for (const id of IDS) state.releasePut(id);
      await poll(async () => (await barText(page)) === 'Value calculated: 4 of 4 done', 'all four finish after the dialog was hidden');
      assert.equal(state.putBodies.length, 4);
      assert.deepEqual(ui.pageErrors, []);
    } finally { await ui.close(); }
  });
}

test('3: Stop on the bar starts no new case-plan request, and the waiting row ends stopped (checked through Open)', async () => {
  // Nothing saved yet, so five use cases can run: four go first and one waits.
  const state = { hold: true, plans: [], puts: [], noSaved: true };
  const { ui, page } = await openBulk(state);
  try {
    await pick(page, NAMES);
    await page.getByRole('button', { name: 'Calculate value for 6', exact: true }).click();
    await dialogOf(page).waitFor();
    await poll(() => state.plans.length === 4, 'four case-plan requests open');
    assert.equal(await dialogOf(page).locator('[data-bulk-state="waiting"]').count(), 1);
    await dialogOf(page).getByRole('button', { name: 'Run in background', exact: true }).click();
    await barOf(page).getByRole('button', { name: 'Stop', exact: true }).click();
    const startedBefore = state.started.length;
    for (const { id } of [...state.plans]) state.releasePlan(id);
    await poll(() => state.puts.length === 4, 'four saves arrive');
    for (const { id } of [...state.puts]) state.releasePut(id);
    await poll(async () => (await barText(page)).startsWith('Value calculated'), 'the run ends');
    assert.equal(state.started.length, startedBefore, 'no new case-plan request after Stop');
    await barOf(page).getByRole('button', { name: 'Open', exact: true }).click();
    assert.equal(await dialogOf(page).locator('[data-bulk-state="stopped"]').count(), 1);
    assert.equal(await dialogOf(page).locator('[data-bulk-state="waiting"]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('4: leaving Results while 2 are held, releasing them while away, and coming back shows their PUTs, the right count and their values', async () => {
  const { state, ui, page } = await startHeld();
  try {
    await dialogOf(page).getByRole('button', { name: 'Run in background', exact: true }).click();
    await barOf(page).waitFor();
    state.releasePut('N01-U02');
    state.releasePut('N01-U03');
    await poll(async () => (await barText(page)) === 'Calculating value: 2 of 4 done', 'the bar says 2 of 4');
    await page.locator('header nav button', { hasText: 'Start' }).click();
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 20000 });
    assert.equal(await barOf(page).count(), 0);
    state.releasePut('N01-U04');
    state.releasePut('N02-U01');
    await poll(() => state.puts.length === 0, 'the held saves were answered while away');
    assert.equal(state.putBodies.length, 4);
    await page.locator('header nav button', { hasText: 'Review' }).click();
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-no]').first().waitFor({ timeout: 20000 });
    await barOf(page).waitFor();
    assert.equal(await barText(page), 'Value calculated: 4 of 4 done');
    for (const id of IDS) {
      await poll(async () => (await text(page.locator(`[data-use-case-no="${id}"] [data-value-amount]`))) === SHOWN[id], `card ${id} shows ${SHOWN[id]}`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('5: while a run is active, Calculate value for N is disabled', async () => {
  const { state, ui, page } = await startHeld();
  try {
    await dialogOf(page).getByRole('button', { name: 'Run in background', exact: true }).click();
    await barOf(page).waitFor();
    const calc = page.getByRole('button', { name: /^Calculate value for \d+$/ });
    await calc.waitFor();
    assert.equal(await calc.isDisabled(), true);
    assert.match((await calc.getAttribute('title')) || '', /running/i);
    for (const id of IDS) state.releasePut(id);
    await poll(async () => (await barText(page)).startsWith('Value calculated'), 'the run ends');
    assert.equal(await calc.isDisabled(), false);
  } finally { await ui.close(); }
});

test('6: finished in the background, the bar says Value calculated: 4 of 4 done; Dismiss removes it', async () => {
  const { state, ui, page } = await startHeld();
  try {
    await dialogOf(page).getByRole('button', { name: 'Run in background', exact: true }).click();
    await barOf(page).waitFor();
    for (const id of IDS) state.releasePut(id);
    await poll(async () => (await barText(page)) === 'Value calculated: 4 of 4 done', 'the bar says Value calculated');
    const meter = barOf(page).getByRole('progressbar');
    assert.equal(await meter.getAttribute('aria-valuenow'), '4');
    assert.equal(await barOf(page).getByRole('button', { name: 'Open', exact: true }).count(), 1);
    await barOf(page).getByRole('button', { name: 'Dismiss', exact: true }).click();
    await barOf(page).waitFor({ state: 'detached' });
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
