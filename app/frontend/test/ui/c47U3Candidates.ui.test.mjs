// c47 UI lane acceptance (REQ-581 U3, after c36): provisional cards on the Monitor across the selected and failure paths.
// - A selected candidate keeps its provisional card until its final use-case card arrives (no gap where the use case shows nowhere).
// - A run whose job ended badly shows no provisional cards and does not read the candidates.
// - An error step on a live run removes the provisional cards already shown, and the Monitor stops reading the candidates.
// - run_failed candidates (the agent closes every open candidate so when the run raises) are never cards.
// Card contract as in c36: [data-candidate-card="<candidate_id>"][data-provisional="true"] inside section[aria-label="Arriving now"].
// Written by the c47 spec writer; the builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { MONITOR_MOUNT, SESSION_LIVE } from './c36Fixtures.mjs';
import { CANDIDATES_EARLY, CANDIDATES_RUN_FAILED, CANDIDATES_SELECTED_NOT_FINAL, CANDIDATE_STEPS_EARLY, ERROR_STEP, RUN_FAILED, RUN_LIVE } from './c47Fixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function candidatesBackend(initial) {
  const feed = { candidates: initial, queries: [] };
  const mount = (app) => {
    MONITOR_MOUNT(app);
    app.get('/api/inspire/candidates', (req, res) => { feed.queries.push({ ...req.query }); res.json({ candidates: feed.candidates }); });
  };
  return { feed, mount };
}
const provisionalIds = (page) => page.locator('section[aria-label="Arriving now"] [data-candidate-card][data-provisional="true"]')
  .evaluateAll((els) => els.map((el) => el.getAttribute('data-candidate-card')));

test('REQ-581 U3: a selected candidate whose final card has not arrived keeps its provisional card in rank order (must-fail on the base)', async () => {
  const { feed, mount } = candidatesBackend(CANDIDATES_SELECTED_NOT_FINAL);
  const ui = await openUi('monitor', { runRead: RUN_LIVE, inspireSession: SESSION_LIVE, runSteps: CANDIDATE_STEPS_EARLY }, '', { mount });
  const { page } = ui;
  try {
    await until(async () => feed.queries.length > 0, 'the Monitor reads the candidates of the live run', 20000);
    await until(async () => (await provisionalIds(page)).length === 3, 'three provisional cards', 20000);
    assert.deepEqual(await provisionalIds(page), ['c-2', 'c-1', 'c-3'], 'the selected c-2 stays first until its final card arrives');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U3: a run whose job ended badly shows no provisional cards and reads no candidates (must-fail on the base)', async () => {
  const { feed, mount } = candidatesBackend(CANDIDATES_EARLY);
  const ui = await openUi('monitor', { runRead: RUN_FAILED, inspireSession: SESSION_LIVE, runSteps: CANDIDATE_STEPS_EARLY }, '', { mount });
  const { page } = ui;
  try {
    await page.locator('[data-run-stepper]').first().waitFor({ timeout: 20000 });
    await pause(6000);
    assert.equal(await page.locator('[data-candidate-card]').count(), 0, 'no provisional card on a failed run');
    assert.equal(feed.queries.length, 0, 'the Monitor does not read the candidates of a failed run');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U3: an error step on a live run removes the provisional cards and stops the candidate reads (must-fail on the base)', async () => {
  const { feed, mount } = candidatesBackend(CANDIDATES_EARLY);
  const ui = await openUi('monitor', { runRead: RUN_LIVE, inspireSession: SESSION_LIVE, runSteps: [...CANDIDATE_STEPS_EARLY] }, '', { mount });
  const { page } = ui;
  try {
    await until(async () => (await provisionalIds(page)).length === 3, 'the eligible candidates show first', 20000);
    ui.made.state.runSteps = [...CANDIDATE_STEPS_EARLY, ERROR_STEP];
    await until(async () => (await provisionalIds(page)).length === 0, 'the provisional cards go once a step failed', 25000);
    const reads = feed.queries.length;
    await pause(6000);
    assert.equal(feed.queries.length, reads, 'no candidate read after the failure');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U3 regression: candidates closed as run_failed are never cards (must-keep)', async () => {
  const { feed, mount } = candidatesBackend(CANDIDATES_EARLY);
  const ui = await openUi('monitor', { runRead: RUN_LIVE, inspireSession: SESSION_LIVE, runSteps: CANDIDATE_STEPS_EARLY }, '', { mount });
  const { page } = ui;
  try {
    await until(async () => (await provisionalIds(page)).length === 3, 'the eligible candidates show first', 20000);
    const reads = feed.queries.length;
    feed.candidates = CANDIDATES_RUN_FAILED;
    await until(async () => feed.queries.length > reads, 'the Monitor reads the candidates again', 20000);
    await until(async () => (await provisionalIds(page)).length === 0, 'run_failed candidates show no card', 20000);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
