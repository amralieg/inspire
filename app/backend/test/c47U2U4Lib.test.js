// c47 UI lane acceptance (REQ-581 U2-U4, the App side of the Discover redesign; contract briefs/c35_ui_interface.md rows U2-U4).
// Pure-logic half, run in plain node (no browser): the frontend libs the Monitor and Results pages use.
//   U2 monitorState.stageProgressOf(steps, live) -> { state, settled, total, percent }: a stage of the Every step dialog. A skipped step is
//      settled (like success and warning), so a stage whose steps all ended, some skipped, is 'done' and 100%; a stage whose steps were all
//      skipped is 'skipped' (neutral); any error -> 'error'; any running -> 'running'; otherwise 'waiting'. Today the dialog counts only
//      success/warning as done, so a skipped step leaves its stage at 0/1 with a waiting clock.
//   U3 candidates.provisionalCardsOf keeps a SELECTED candidate as a provisional card until its final use-case card arrives (no gap between
//      the two); run_failed and every other terminal state show no card. candidatesWanted(steps, { runFailed }) is false when the run job
//      ended badly; candidatesDropped(steps, { runFailed, finished }) says when the Monitor must clear the cards it shows (failure or end).
//   U4 candidates.pendingKindsFor(pending, useCaseId, made) leaves out a kind whose real artifact the use case already has (made[kind]).
// candidates.js must import './monitorState.js' (with the extension) so plain node can load it, like every other lib these tests import.
// Written by the c47 spec writer; the builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const step = (stage, status) => ({ stage_name: stage, step_name: `${stage} ${status}`, status });
const cand = (candidate_id, state, name, provisional_rank = null) => ({ candidate_id, state, name, provisional_rank, merged_into: null });

test('REQ-581 U2: a stage whose steps ended with one skipped is done and 100%; an all-skipped stage is skipped, never waiting (must-fail on the base)', async () => {
  const { stageProgressOf } = await lib('monitorState.js');
  assert.equal(typeof stageProgressOf, 'function', 'monitorState.js exports stageProgressOf');
  assert.deepEqual(stageProgressOf([step('A', 'ended_success'), step('A', 'skipped')], false), { state: 'done', settled: 2, total: 2, percent: 100 });
  assert.deepEqual(stageProgressOf([step('A', 'skipped')], true), { state: 'skipped', settled: 1, total: 1, percent: 100 });
  assert.deepEqual(stageProgressOf([step('A', 'skipped'), step('A', 'skipped')], false), { state: 'skipped', settled: 2, total: 2, percent: 100 });
  assert.deepEqual(stageProgressOf([step('A', 'ended_warning'), step('A', 'skipped'), step('A', 'completed')], true), { state: 'done', settled: 3, total: 3, percent: 100 });
});

test('REQ-581 U2 regression: error, running, waiting and empty stages keep their meaning; skipped never hides an error (must-keep once it exists)', async () => {
  const { stageProgressOf } = await lib('monitorState.js');
  assert.equal(typeof stageProgressOf, 'function', 'monitorState.js exports stageProgressOf');
  assert.deepEqual(stageProgressOf([step('A', 'ended_error'), step('A', 'skipped')], false), { state: 'error', settled: 1, total: 2, percent: 50 });
  assert.deepEqual(stageProgressOf([step('A', 'started'), step('A', 'skipped')], true), { state: 'running', settled: 1, total: 2, percent: 50 });
  assert.deepEqual(stageProgressOf([step('A', 'started'), step('A', 'skipped')], false), { state: 'waiting', settled: 1, total: 2, percent: 50 });
  assert.deepEqual(stageProgressOf([step('A', 'ended_success'), step('A', 'ended_success')], false), { state: 'done', settled: 2, total: 2, percent: 100 });
  assert.deepEqual(stageProgressOf([], true), { state: 'waiting', settled: 0, total: 0, percent: 0 });
});

test('REQ-581 U3: a selected candidate keeps its provisional card until its final card arrives, then it goes (must-fail on the base)', async () => {
  const { provisionalCardsOf } = await lib('candidates.js');
  const list = [cand('c-1', 'eligible', 'Forecast weekly demand', 2), cand('c-2', 'selected', 'Reduce customer churn', 1), cand('c-3', 'eligible', 'Score supplier risk', 3)];
  assert.deepEqual(provisionalCardsOf(list, []).map((c) => c.candidate_id), ['c-2', 'c-1', 'c-3'], 'selected, final card not arrived yet: still shown, in rank order');
  assert.deepEqual(provisionalCardsOf(list, [{ name: ' reduce  customer churn ' }]).map((c) => c.candidate_id), ['c-1', 'c-3'], 'its final card arrived: the provisional card goes');
});

test('REQ-581 U3 regression: run_failed and every other terminal or early state is never a provisional card (must-keep)', async () => {
  const { provisionalCardsOf } = await lib('candidates.js');
  const states = ['proposed', 'grounded', 'measured', 'merged', 'overlapping', 'lower_marginal', 'unmeasured', 'blocked', 'run_failed'];
  assert.deepEqual(provisionalCardsOf(states.map((s, i) => cand(`x-${i}`, s, `Use case ${i}`, i + 1)), []), []);
  assert.deepEqual(provisionalCardsOf(null, []), []);
});

test('REQ-581 U3: a run whose job ended badly wants no candidates, and the Monitor drops the cards it shows on failure or at the end (must-fail on the base)', async () => {
  const { candidatesWanted, candidatesDropped } = await lib('candidates.js');
  const live = [step('Setup', 'ended_success'), step('Use Cases Generation', 'started')];
  assert.equal(candidatesWanted(live), true, 'a live use case stage wants candidates');
  assert.equal(candidatesWanted(live, { runFailed: true }), false, 'not when the run job ended badly');
  assert.equal(typeof candidatesDropped, 'function', 'candidates.js exports candidatesDropped');
  assert.equal(candidatesDropped(live, {}), false, 'a live run keeps its cards');
  assert.equal(candidatesDropped(live, { runFailed: true }), true, 'the job ended badly: drop the cards');
  assert.equal(candidatesDropped([...live, step('Use Cases Generation', 'ended_error')], {}), true, 'an error step: drop the cards');
  assert.equal(candidatesDropped(live, { finished: true }), true, 'the session finished: drop the cards');
  assert.equal(candidatesDropped([step('Setup', 'ended_success'), step('Use Case Prioritization', 'started')], {}), false,
    'the use case stage moved on but nothing failed: keep the cards until the final cards arrive');
});

test('REQ-581 U3 regression: a missing or empty candidates answer is an empty list (must-keep)', async () => {
  const { fetchCandidates } = await lib('candidates.js');
  const args = { inspireDatabase: 'main.inspire', warehouseId: 'wh1', sessionId: 42 };
  assert.deepEqual(await fetchCandidates(async () => ({ candidates: [] }), args), []);
  assert.deepEqual(await fetchCandidates(async () => ({}), args), []);
  assert.deepEqual(await fetchCandidates(async () => null, args), []);
});

test('REQ-581 U4: a kind the use case already has is not pending; the others stay pending (must-fail on the base)', async () => {
  const { pendingKindsFor } = await lib('candidates.js');
  const pending = [{ kind: 'notebook', use_case_id: 'N01-U01' }, { kind: 'genie_instructions', use_case_id: 'N01-U01' }, { kind: 'docs', use_case_id: null },
    { kind: 'translation', use_case_id: null }];
  assert.deepEqual(pendingKindsFor(pending, 'N01-U01', { notebook: true, docs: true }), ['genie_instructions', 'translation']);
  assert.deepEqual(pendingKindsFor(pending, 'N01-U02', { docs: true }), ['translation']);
});

test('REQ-581 U4 regression: without made artifacts the pending kinds are as before, and an empty list is no kinds (must-keep)', async () => {
  const { pendingKindsFor } = await lib('candidates.js');
  const pending = [{ kind: 'notebook', use_case_id: 'N01-U01' }, { kind: 'docs', use_case_id: null }, { kind: 'bogus', use_case_id: null }, null];
  assert.deepEqual(pendingKindsFor(pending, 'N01-U01'), ['notebook', 'docs']);
  assert.deepEqual(pendingKindsFor(pending, 'N01-U02', {}), ['docs']);
  assert.deepEqual(pendingKindsFor([], 'N01-U01', { docs: true }), []);
  assert.deepEqual(pendingKindsFor(undefined, 'N01-U01'), []);
});
