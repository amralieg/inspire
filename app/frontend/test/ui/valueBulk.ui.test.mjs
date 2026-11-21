// REQ-441: select many cards, "Calculate value for N", a progress panel; four at once, defaults, saved as estimates (calculated false).
// HTTP-level stubs of POST case-plan and PUT answers that can be held open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { DEFAULTS, PLAN } from './valueWizardSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { initialAnswers } from '../../src/lib/valueWizard.js';

test.after(closeBrowser);

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
  state.releasePut = (id) => answer(state.puts, id, (res) => res.json({ version: 1, yearly: yearlyOf(AMOUNTS[id]), disclaimer: 'x' }));
  state.started = [];
  state.putBodies = [];
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/overall', (_req, res) => res.json({ at_stake: [], saved: [], runs: 0, businesses: 0 }));
    app.get('/api/inspire/value/runs', (_req, res) => res.json({ runs: {} }));
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/totals', (_req, res) => res.json({ run: { totals: [], n: 0, n_calculated: 0, n_estimated: 0, n_none: 0, by_verb: [] }, use_cases: {} }));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: { 'N01-U01': SAVED } }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
    app.post('/api/inspire/value/case-plan', (req, res) => {
      const id = req.body.use_case_id;
      state.started.push(id);
      if (state.planStatus?.[id]) return res.status(state.planStatus[id]).json({ error: state.planStatus[id] === 422 ? 'The table has no date column to estimate from.' : 'The plan service is down.' });
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
  const ui = await openUi('results', { ...REVIEW_STATE, results: RESULTS }, '', { mount: mountBulk(state) });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[aria-expanded]').first().waitFor();
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

test('1: six cards selected (one saved, one without a table): 6 rows, four case-plan requests open at once, PUT bodies are the defaults with calculated false, rows and cards fill in as each ends', async () => {
  const state = { hold: true, plans: [], puts: [] };
  const { ui, page } = await openBulk(state);
  try {
    await pick(page, NAMES);
    await page.getByRole('button', { name: 'Calculate value for 6', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Calculating value' });
    await panel.waitFor();
    assert.equal(await panel.locator('[data-bulk-row]').count(), 6);
    await poll(() => state.plans.length === 4, 'four case-plan requests open');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(state.plans.length, 4, 'exactly four open');
    assert.deepEqual([...state.started].sort(), Object.keys(AMOUNTS).sort());
    assert.equal(await text(panel.locator('[data-bulk-progress]')), '0 of 4 done');
    assert.equal(await panel.locator('[data-bulk-row="N01-U02"]').getAttribute('data-bulk-state'), 'working');
    assert.equal(await text(panel.locator('[data-bulk-row="N01-U01"]')).then((t) => t.includes('already has a value')), true);
    assert.equal(await text(panel.locator('[data-bulk-row="N02-U02"]')).then((t) => t.includes('no table to count')), true);
    for (const id of Object.keys(AMOUNTS)) state.releasePlan(id);
    await poll(() => state.puts.length === 4, 'four saves arrive');
    const want = initialAnswers(PLAN).drivers;
    for (const body of state.putBodies) {
      assert.equal(body.answers.calculated, false);
      assert.deepEqual(body.answers.drivers, want);
      assert.equal(body.use_case_id in AMOUNTS, true);
    }
    let finished = 0;
    for (const id of Object.keys(AMOUNTS)) {
      state.releasePut(id);
      finished += 1;
      await poll(async () => (await text(panel.locator('[data-bulk-progress]'))) === `${finished} of 4 done`, `${finished} of 4 done`);
      assert.match(await text(panel.locator(`[data-bulk-row="${id}"]`)), new RegExp(SHOWN[id].replace('$', '\\$')));
      await poll(async () => (await text(page.locator(`[data-use-case-no="${id}"] [data-value-amount]`))) === SHOWN[id], `card ${id} shows ${SHOWN[id]}`);
    }
    assert.equal(await text(panel.locator('[data-bulk-progress]')), '4 of 4 done');
    assert.equal(await panel.getByRole('button', { name: 'Stop' }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: 'Close', exact: true }).count() > 0, true);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('2: a case-plan that answers 500 shows failed with Retry; Retry with the stub fixed makes it done', async () => {
  const state = { hold: false, plans: [], puts: [], planStatus: { 'N01-U03': 500 } };
  const { ui, page } = await openBulk(state);
  try {
    await pick(page, ['Score upsell', 'Segment shoppers']);
    await page.getByRole('button', { name: 'Calculate value for 2', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Calculating value' });
    const row = panel.locator('[data-bulk-row="N01-U03"]');
    await row.locator('button', { hasText: 'Retry' }).waitFor();
    assert.equal(await row.getAttribute('data-bulk-state'), 'failed');
    assert.equal(await panel.locator('[data-bulk-row="N01-U02"]').getAttribute('data-bulk-state'), 'done');
    assert.equal(await text(panel.locator('[data-bulk-progress]')), '1 of 2 done');
    delete state.planStatus['N01-U03'];
    await row.getByRole('button', { name: 'Retry' }).click();
    await poll(async () => (await row.getAttribute('data-bulk-state')) === 'done', 'the retried row is done');
    assert.equal(await text(panel.locator('[data-bulk-progress]')), '2 of 2 done');
    assert.equal(state.started.filter((id) => id === 'N01-U02').length, 1, 'Retry re-runs only that use case');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 500/.test(String(e))), []);
  } finally { await ui.close(); }
});

test('FX-28: a case-plan that answers 422 shows skipped with the reason and no Retry; a 500 row still has Retry', async () => {
  const state = { hold: false, plans: [], puts: [], planStatus: { 'N01-U03': 422, 'N01-U04': 500 } };
  const { ui, page } = await openBulk(state);
  try {
    await pick(page, ['Score upsell', 'Segment shoppers', 'Price elasticity']);
    await page.getByRole('button', { name: 'Calculate value for 3', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Calculating value' });
    const skipped = panel.locator('[data-bulk-row="N01-U03"]');
    const failed = panel.locator('[data-bulk-row="N01-U04"]');
    await failed.locator('button', { hasText: 'Retry' }).waitFor();
    assert.equal(await skipped.getAttribute('data-bulk-state'), 'skipped');
    assert.match(await text(skipped), /Skipped: The table has no date column/);
    assert.equal(await skipped.locator('button', { hasText: 'Retry' }).count(), 0);
    assert.equal(await panel.locator('[data-bulk-row="N01-U02"]').getAttribute('data-bulk-state'), 'done');
    assert.equal(await failed.getAttribute('data-bulk-state'), 'failed');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of (500|422)/.test(String(e))), []);
  } finally { await ui.close(); }
});
