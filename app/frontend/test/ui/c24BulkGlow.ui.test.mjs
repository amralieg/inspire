// REQ-464 (Amr P183, REQ-557): while a bulk Calculate value job runs, the value box of each use case in the run glows; it stops when the job ends; a use case outside the run never glows.
// Same HTTP-level stubs as valueBulkBackground.ui.test.mjs (case-plan and PUT answers held open).
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

const glowOf = (page, id) => page.locator(`[data-use-case-no="${id}"] [data-value-calculating="on"]`);
const glowing = async (page, id) => (await glowOf(page, id).count()) > 0;
const RUN3 = ['Score upsell', 'Segment shoppers', 'Price elasticity'];
const ID3 = ['N01-U02', 'N01-U03', 'N01-U04'];

// Three selected, all running: three case plans held open.
async function startThree(extra = {}) {
  const state = { hold: true, plans: [], puts: [], ...extra };
  const { ui, page } = await openBulk(state);
  await pick(page, RUN3);
  await page.getByRole('button', { name: 'Calculate value for 3', exact: true }).click();
  await dialogOf(page).waitFor();
  await poll(() => state.plans.length === 3, 'three case-plan requests open');
  return { state, ui, page };
}

test('1: boxes of the running use cases glow, a finished one stops, a use case outside the run never glows', async () => {
  const { state, ui, page } = await startThree();
  try {
    for (const id of ID3) await poll(() => glowing(page, id), `card ${id} glows`);
    for (const id of ['N01-U01', 'N02-U01']) assert.equal(await glowing(page, id), false, `${id} is not in the run and never glows`);
    state.releasePlan('N01-U02');
    await poll(() => state.puts.length === 1, 'one save arrives');
    state.releasePut('N01-U02');
    await poll(async () => !(await glowing(page, 'N01-U02')), 'the finished card stops glowing');
    assert.equal(await glowing(page, 'N01-U03'), true);
    assert.equal(await glowing(page, 'N01-U04'), true);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('2: a waiting card does not glow yet', async () => {
  const state = { hold: true, plans: [], puts: [], noSaved: true };
  const { ui, page } = await openBulk(state);
  try {
    await pick(page, NAMES.slice(0, 5));
    await page.getByRole('button', { name: 'Calculate value for 5', exact: true }).click();
    await dialogOf(page).waitFor();
    await poll(() => state.plans.length === 4, 'four case-plan requests open');
    const on = [];
    for (const id of ['N01-U01', ...ID3, 'N02-U01']) if (await glowing(page, id)) on.push(id);
    assert.equal(on.length, 4, `four glow, one waits (glowing: ${on})`);
    assert.equal(await dialogOf(page).locator('[data-bulk-state="waiting"]').count(), 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('3: a failed job stops the glow too, and the glow survives Run in background until the run ends', async () => {
  const state = { hold: true, plans: [], puts: [], planStatus: { 'N01-U03': 500 } };
  const { ui, page } = await openBulk(state);
  try {
    await pick(page, RUN3);
    await page.getByRole('button', { name: 'Calculate value for 3', exact: true }).click();
    await dialogOf(page).waitFor();
    await poll(() => state.plans.length === 2, 'two case-plan requests open, the third failed');
    for (const id of ['N01-U02', 'N01-U04']) await poll(() => glowing(page, id), `card ${id} glows`);
    await poll(async () => !(await glowing(page, 'N01-U03')), 'the failed card does not glow');
    await dialogOf(page).getByRole('button', { name: 'Run in background', exact: true }).click();
    for (const id of ['N01-U02', 'N01-U04']) assert.equal(await glowing(page, id), true, `${id} still glows in the background`);
    for (const { id } of [...state.plans]) state.releasePlan(id);
    await poll(() => state.puts.length === 2, 'two saves arrive');
    for (const { id } of [...state.puts]) state.releasePut(id);
    for (const id of ID3) await poll(async () => !(await glowing(page, id)), `${id} stops glowing when the run ends`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
