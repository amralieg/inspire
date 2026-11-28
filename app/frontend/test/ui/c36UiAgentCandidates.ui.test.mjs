// c36 UI lane acceptance (REQ-581, U3 in the agent/UI interface; R4.3 "publish a card as soon as it is eligible, with a provisional rank").
// While a run is live the Monitor reads GET /api/inspire/candidates (session_id, inspire_database, warehouse_id) and shows one
// provisional card per eligible candidate in the Arriving now section, in provisional_rank order, marked Provisional. When a candidate
// is selected and its final use case arrives in a step row, the final use-case card replaces the provisional one (no duplicate).
// Merged or overlapping candidates are never provisional cards: they are hidden, or shown as "merged into <id or name>".
// Card contract: [data-candidate-card="<candidate_id>"] with data-provisional="true" and data-provisional-rank="<n>".
// Written by the c36 spec writer; the builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { CANDIDATES_EARLY, CANDIDATES_LATER, CANDIDATE_STEPS_EARLY, FINAL_USE_CASE_STEP, MERGED, MONITOR_MOUNT, NOT_PROVISIONAL, PROVISIONAL_ORDER,
  RUN_LIVE, SESSION_LIVE } from './c36Fixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const byId = Object.fromEntries(CANDIDATES_EARLY.map((c) => [c.candidate_id, c]));

function candidatesBackend(initial) {
  const feed = { candidates: initial, queries: [] };
  const mount = (app) => {
    MONITOR_MOUNT(app);
    app.get('/api/inspire/candidates', (req, res) => { feed.queries.push({ ...req.query }); res.json({ candidates: feed.candidates }); });
  };
  return { feed, mount };
}
const arriving = (page) => page.locator('section[aria-label="Arriving now"]');
const provisionalCards = (page) => arriving(page).locator('[data-candidate-card][data-provisional="true"]');

test('REQ-581 U3: eligible candidates show as provisional cards in provisional_rank order; merged and overlapping are not provisional (must-fail on the base)', async () => {
  const { feed, mount } = candidatesBackend(CANDIDATES_EARLY);
  const ui = await openUi('monitor', { runRead: RUN_LIVE, inspireSession: SESSION_LIVE, runSteps: CANDIDATE_STEPS_EARLY }, '', { mount });
  const { page } = ui;
  try {
    await until(async () => feed.queries.length > 0, 'the Monitor reads the candidates of the live run', 20000);
    const q = feed.queries[0];
    assert.equal(String(q.session_id), '42');
    assert.equal(q.inspire_database, 'main.inspire');
    assert.equal(q.warehouse_id, 'wh1');
    await until(async () => (await provisionalCards(page).count()) === PROVISIONAL_ORDER.length, 'one provisional card per eligible candidate', 20000);
    const shown = await provisionalCards(page).evaluateAll((els) => els.map((el) => [el.getAttribute('data-candidate-card'), el.getAttribute('data-provisional-rank'), el.innerText]));
    assert.deepEqual(shown.map(([id]) => id), PROVISIONAL_ORDER, 'cards follow provisional_rank, not arrival order');
    for (const [id, rank, text] of shown) {
      assert.equal(Number(rank), byId[id].provisional_rank, `${id} carries its provisional rank`);
      assert.ok(text.includes(byId[id].name), `${id} shows its name`);
      assert.match(text, /Provisional/i, `${id} is marked provisional`);
    }
    for (const id of NOT_PROVISIONAL) {
      assert.equal(await page.locator(`[data-candidate-card="${id}"][data-provisional="true"]`).count(), 0, `${id} (${byId[id].state}) is not a provisional card`);
    }
    for (const [id, { into, intoName }] of Object.entries(MERGED)) {
      const card = page.locator(`[data-candidate-card="${id}"]`);
      if (await card.count()) {
        const text = await card.first().innerText();
        assert.match(text, /merged into/i, `${id} says it was merged`);
        assert.ok(text.includes(into) || text.includes(intoName), `${id} names what it was merged into`);
      }
    }
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U3: a selected candidate is replaced by its final use-case card (must-fail on the base)', async () => {
  const { feed, mount } = candidatesBackend(CANDIDATES_EARLY);
  const ui = await openUi('monitor', { runRead: RUN_LIVE, inspireSession: SESSION_LIVE, runSteps: [...CANDIDATE_STEPS_EARLY] }, '', { mount });
  const { page } = ui;
  try {
    await page.locator('[data-candidate-card="c-2"][data-provisional="true"]').waitFor({ timeout: 20000 });
    const reads = feed.queries.length;
    feed.candidates = CANDIDATES_LATER;
    ui.made.state.runSteps = [...CANDIDATE_STEPS_EARLY, FINAL_USE_CASE_STEP];
    await until(async () => feed.queries.length > reads, 'the Monitor reads the candidates again while the run is live', 25000);
    const finalName = FINAL_USE_CASE_STEP.result_json.use_cases[0].name;
    await until(async () => (await arriving(page).locator('[data-live-use-case]').filter({ hasText: finalName }).count()) === 1, 'the final use-case card arrives', 25000);
    await until(async () => (await page.locator('[data-candidate-card="c-2"][data-provisional="true"]').count()) === 0, 'the provisional card of the selected candidate is gone', 25000);
    const sectionText = await arriving(page).innerText();
    assert.equal(sectionText.split(finalName).length - 1, 1, 'the selected use case shows once, not as a provisional and a final card');
    assert.deepEqual(await provisionalCards(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-candidate-card'))), ['c-1', 'c-3'],
      'the other eligible candidates stay provisional in rank order');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U3 regression: no candidates means no provisional cards and no errors (must-keep)', async () => {
  const { mount } = candidatesBackend([]);
  const ui = await openUi('monitor', { runRead: RUN_LIVE, inspireSession: SESSION_LIVE, runSteps: CANDIDATE_STEPS_EARLY }, '', { mount });
  const { page } = ui;
  try {
    await page.locator('[data-run-stepper]').first().waitFor({ timeout: 20000 });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(await page.locator('[data-candidate-card]').count(), 0);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
