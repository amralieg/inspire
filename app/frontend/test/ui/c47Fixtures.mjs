// c47 UI lane (REQ-581 U2-U4) shared fixtures. Builds on the c36 fixtures (same run 777, session 42, step row shape); industry-neutral names.
// Written by the c47 spec writer; no builder edits it.
import { CANDIDATES_EARLY, CANDIDATE_STEPS_EARLY, RUN_LIVE, stepRow } from './c36Fixtures.mjs';

const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// U2: a finished run where one stage mixes a success and a skipped step, and one stage has only a skipped step.
export const MIXED_STAGE = 'Use Case Prioritization';
export const SKIPPED_STAGE = 'Business Domain Clustering';
export const SKIP_STAGE_STEPS = [
  stepRow('Setup', 'Read the settings', 'ended_success', 40),
  stepRow('Business Understanding', 'Business context', 'ended_success', 38),
  stepRow('Data Preparation', 'Read the tables', 'ended_success', 35),
  stepRow('Use Cases Generation', 'Write use cases', 'ended_success', 30),
  stepRow(SKIPPED_STAGE, 'Subdomain Detector', 'skipped', 25, { message: 'Switched off for this run' }),
  stepRow(MIXED_STAGE, 'Score and rank', 'ended_success', 20),
  stepRow(MIXED_STAGE, 'Pick the best of best', 'skipped', 19, { message: 'Switched off for this run' }),
  stepRow('Executive Readout', 'Write the summary', 'ended_success', 10),
  stepRow('Implementation Planning', 'Plan the build', 'ended_success', 5),
];

// U3: c-2 was selected but its final use case has not been written yet (no step row carries it).
export const CANDIDATES_SELECTED_NOT_FINAL = CANDIDATES_EARLY.map((c) => (c.candidate_id === 'c-2' ? { ...c, state: 'selected', event_at: ago(2 * MINUTE) } : c));
// U3: the run raised; the agent closed every non-terminal candidate as run_failed.
export const CANDIDATES_RUN_FAILED = CANDIDATES_EARLY.map((c) => (['eligible', 'measured', 'proposed'].includes(c.state) ? { ...c, state: 'run_failed', event_at: ago(MINUTE) } : c));
// U3: the job ended badly while the session row is not finished yet.
export const RUN_FAILED = { status: 200, body: { ...RUN_LIVE.body, life_cycle_state: 'TERMINATED', result_state: 'FAILED', end_time: Date.now() - MINUTE,
  state_message: 'Task failed' } };
export const ERROR_STEP = stepRow('Use Cases Generation', 'Score use cases', 'ended_error', 1, { message: 'The scoring call failed' });
export { CANDIDATES_EARLY, CANDIDATE_STEPS_EARLY, RUN_LIVE };

// U4: the harness Results use cases are N01-U01 "Predict churn" and N01-U02 "Score upsell".
export const PENDING_ALL = [
  { kind: 'genie_instructions', use_case_id: 'N01-U01' },
  { kind: 'notebook', use_case_id: 'N01-U01' },
  { kind: 'docs', use_case_id: null },
];
// The __inspire_usecases rows once Implement has produced the artifacts of N01-U01 (docs and notebook).
export const MADE_ROWS = [{ id: 'N01-U01', session_id: 42, docs_generated_at: '2026-11-28T10:00:00Z', notebook_path: '/Workspace/Users/owner@example.com/inspire/N01-U01' }];
export const NOTEBOOK_RUNNING = { run_id: '9', state: 'running', url: '' };
export const NOTEBOOK_DONE = { run_id: '9', state: 'succeeded', url: '' };
