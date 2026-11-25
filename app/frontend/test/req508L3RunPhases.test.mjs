// REQ-508 L3 (Art Director pass; Amr: "7 phases" with the parallel pair, each phase driven by the real backend status, skipped phases
// show as skipped and never green). The Monitor and Review share one step model, src/lib/runPhases.js, built from the agent's own
// stage-to-phase map (PROGRESS_STAGE_PHASES in app/agent/agent/dbx_inspire_ai_agent.ipynb). Audit scratch/req508_art_director.md section 3.
// Fail-pre (15eb146b9): there is no shared step model; the Review bar marks every stage green (ResultsAssets.jsx:73-85) and the Monitor
// shows a percentage with no steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTEBOOK = path.resolve(FRONTEND, '../agent/agent/dbx_inspire_ai_agent.ipynb');
const load = () => import(pathToFileURL(path.join(FRONTEND, 'src/lib/runPhases.js')).href);

const KEYS = ['setup', 'context', 'tables', 'generation', 'domains', 'prioritization', 'implementation', 'readout'];
let n = 0;
const row = (stage_name, status, extra = {}) => ({ step_id: String(++n), stage_name, step_name: `${stage_name} step`, status,
  last_updated: `2026-11-23T10:${String(n % 60).padStart(2, '0')}:00Z`, ...extra });
const states = (phases) => Object.fromEntries(phases.map((p) => [p.key, p.state]));
const FULL = ['Setup', 'Business Understanding', 'Data Preparation', 'Use Cases Generation', 'Domain Mapping', 'Use Case Prioritization',
  'Implement Use Cases', 'Executive Readout'];

// The notebook's stage -> phase dict, read from the cell source (IMPLEMENT_STAGE resolved), so the App cannot drift from the agent.
function notebookPhaseMap() {
  const nb = JSON.parse(readFileSync(NOTEBOOK, 'utf8'));
  const src = nb.cells.map((c) => (Array.isArray(c.source) ? c.source.join('') : String(c.source || ''))).join('\n');
  const implement = src.match(/^IMPLEMENT_STAGE\s*=\s*"([^"]+)"/m)?.[1];
  const body = src.match(/^PROGRESS_STAGE_PHASES\s*=\s*\{([\s\S]*?)^\}/m)?.[1];
  assert.ok(implement && body, 'the notebook still defines IMPLEMENT_STAGE and PROGRESS_STAGE_PHASES');
  const map = {};
  for (const m of body.matchAll(/^\s*(?:"([^"]+)"|(IMPLEMENT_STAGE))\s*:\s*"([a-z_]+)"/gm)) map[m[1] || implement] = m[3];
  return map;
}

test('RUN_PHASES is the 7-step model: six sequential columns, then Build Databricks AI instructions and Write documents side by side in column 7', async () => {
  const { RUN_PHASES } = await load();
  assert.deepEqual(RUN_PHASES.map((p) => p.key), KEYS);
  assert.deepEqual(RUN_PHASES.map((p) => p.column), [1, 2, 3, 4, 5, 6, 7, 7]);
  assert.deepEqual(RUN_PHASES.map((p) => p.label), ['Setup', 'Understand the business', 'Read the data', 'Write use cases', 'Group into domains',
    'Score and rank', 'Build Databricks AI instructions', 'Write documents']);
});

test('drift guard: phaseOfStage agrees with the agent notebook for every stage it names, plus "Generate *" and the pseudo-stages', async () => {
  const { phaseOfStage } = await load();
  const map = notebookPhaseMap();
  assert.ok(Object.keys(map).length >= 18, `the notebook map parsed (${Object.keys(map).length} stages)`);
  for (const [stage, phase] of Object.entries(map)) assert.equal(phaseOfStage(stage), phase, `${stage} -> ${phase}`);
  assert.equal(phaseOfStage('Generate Genie Space'), 'implementation', 'every "Generate " stage is implementation, as in phase_of');
  for (const pseudo of ['Inspire Journey', 'Pipeline', 'Something New', '', null, undefined]) assert.equal(phaseOfStage(pseudo), null, `${pseudo} has no phase`);
});

test('a run where every phase ended well shows eight done steps', async () => {
  const { runPhasesOf } = await load();
  const out = runPhasesOf(FULL.map((s) => row(s, 'ended_success')).concat(row('Localization', 'ended_success')), { ended: true });
  assert.deepEqual(out.map((p) => p.key), KEYS);
  assert.deepEqual(new Set(out.map((p) => p.state)), new Set(['done']));
});

test('Amr: skipped phases show as skipped, never done: a from-json run (Setup, then the documents) skips 2-6 and Build Databricks AI instructions', async () => {
  const { runPhasesOf } = await load();
  const out = states(runPhasesOf([row('Setup', 'ended_success'), row('Executive Readout', 'ended_success'), row('Localization', 'ended_success')], { ended: true }));
  assert.deepEqual(out, { setup: 'done', context: 'skipped', tables: 'skipped', generation: 'skipped', domains: 'skipped', prioritization: 'skipped',
    implementation: 'skipped', readout: 'done' });
});

test('an implement-only run marks the discovery phases skipped and the documents skipped once it ends', async () => {
  const { runPhasesOf } = await load();
  const out = states(runPhasesOf([row('Setup', 'ended_success'), row('Implement Use Cases', 'ended_success')], { ended: true }));
  assert.equal(out.implementation, 'done');
  for (const k of ['context', 'tables', 'generation', 'domains', 'prioritization', 'readout']) assert.equal(out[k], 'skipped', k);
});

test('mid-run: finished phases are done, the running phase is active, later phases are todo (not skipped while the run is live)', async () => {
  const { runPhasesOf } = await load();
  const out = states(runPhasesOf([row('Setup', 'ended_success'), row('Business Understanding', 'ended_success'), row('Data Preparation', 'ended_success'),
    row('Use Cases Generation', 'started')], { ended: false }));
  assert.deepEqual(out, { setup: 'done', context: 'done', tables: 'done', generation: 'active', domains: 'todo', prioritization: 'todo',
    implementation: 'todo', readout: 'todo' });
});

test('the parallel pair can both be active at once', async () => {
  const { runPhasesOf } = await load();
  const out = states(runPhasesOf(FULL.slice(0, 6).map((s) => row(s, 'ended_success')).concat([row('Implement Use Cases', 'started'),
    row('Executive Readout', 'started')]), { ended: false }));
  assert.equal(out.implementation, 'active');
  assert.equal(out.readout, 'active');
});

test('an error wins over every other row in its phase, and phases after the failure stay todo ("not reached"), not skipped', async () => {
  const { runPhasesOf } = await load();
  const out = states(runPhasesOf([row('Setup', 'ended_success'), row('Business Understanding', 'ended_success'), row('Data Preparation', 'ended_success'),
    row('Use Case Design', 'ended_success'), row('Use Cases Generation', 'ended_error')], { ended: true }));
  assert.equal(out.generation, 'error');
  for (const k of ['domains', 'prioritization', 'implementation', 'readout']) assert.equal(out[k], 'todo', k);
});

test('a warning row makes its phase "warning" (done with warnings), not plain done', async () => {
  const { runPhasesOf } = await load();
  const out = states(runPhasesOf([row('Setup', 'ended_success'), row('Use Case Prioritization', 'ended_success'), row('Quality Gates', 'ended_warning')],
    { ended: false }));
  assert.equal(out.prioritization, 'warning');
});

test('Inspire Journey and Pipeline rows never move a phase, and a started row then an ended row for the same step_id is done', async () => {
  const { runPhasesOf } = await load();
  const journey = states(runPhasesOf([row('Inspire Journey', 'ended_error'), row('Pipeline', 'started'), row('Setup', 'ended_success')], { ended: false }));
  assert.equal(journey.setup, 'done');
  assert.ok(!Object.values(journey).includes('error'), 'the pseudo-stage error does not paint a phase red');
  const merged = states(runPhasesOf([
    { step_id: 'x1', stage_name: 'Setup', step_name: 'Setup', status: 'started', last_updated: '2026-11-23T10:00:00Z' },
    { step_id: 'x1', stage_name: 'Setup', step_name: 'Setup', status: 'ended_success', last_updated: '2026-11-23T10:01:00Z' },
  ], { ended: false }));
  assert.equal(merged.setup, 'done');
});

test('no rows at all: every phase is todo while the run is live (must-keep: nothing is green by default)', async () => {
  const { runPhasesOf } = await load();
  assert.deepEqual(new Set(runPhasesOf([], { ended: false }).map((p) => p.state)), new Set(['todo']));
  assert.deepEqual(new Set(runPhasesOf(undefined, { ended: false }).map((p) => p.state)), new Set(['todo']));
});
